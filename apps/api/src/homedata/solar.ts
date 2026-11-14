/**
 * The roof as Google Solar models it: how many panels fit on the faces worth
 * using, which way the best face points, and what each panel would make in a
 * year. Google's yearly figure comes from its own sun and shade model of the
 * roof (trees, chimneys, the house next door), so no visitor is asked about
 * roof size or shading when Google has the home.
 *
 * Two calls with one key (`GOOGLE_MAPS_API_KEY`, with the Geocoding and Solar
 * APIs enabled on it): the address to a rooftop point, then the building
 * nearest that point. A point that is not a rooftop match (a street or a
 * postcode centre) is not used, nor a building far from it: Google's
 * `findClosest` would happily return a neighbour's roof, and a neighbour's
 * roof is worse than a typical one.
 *
 * What is kept for the session is a compact summary (`GoogleRoof`), not the
 * full response: the engine needs the panel layouts' sizes and yearly energy,
 * the panel wattage, and the best face's pitch and direction.
 */

import {
  deriveGeometry,
  usableGoogleSolarPanelCount,
  type GoogleSolarBuildingInsights,
} from '@sunny/quote-engine';

const TIMEOUT_MS = 4000;
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const INSIGHTS_URL = 'https://solar.googleapis.com/v1/buildingInsights:findClosest';

/** The furthest Google's building may sit from the address's rooftop point. */
const MAX_BUILDING_DISTANCE_M = 40;

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface SolarClient {
  /** The address's rooftop point, or null when Google cannot place it on a roof. */
  geocode(address: string): Promise<LatLngPoint | null>;
  /** The building nearest a point, or null when Google has no roof model there. */
  buildingInsights(point: LatLngPoint): Promise<GoogleSolarBuildingInsights | null>;
}

/** Google over HTTP. A 404 from the Solar API means no model here, not an error. */
export function httpSolarClient(apiKey: string, fetchFn: typeof fetch = fetch): SolarClient {
  return {
    async geocode(address) {
      const q = new URLSearchParams({
        address,
        region: 'uk',
        components: 'country:GB',
        key: apiKey,
      });
      const response = await fetchFn(`${GEOCODE_URL}?${q}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Geocoding answered ${response.status}`);
      const body = (await response.json()) as {
        status?: string;
        results?: Array<{
          geometry?: { location?: { lat: number; lng: number }; location_type?: string };
        }>;
      };
      const first = body.results?.[0]?.geometry;
      if (body.status !== 'OK' || !first?.location || first.location_type !== 'ROOFTOP') {
        return null;
      }
      return { lat: first.location.lat, lng: first.location.lng };
    },
    async buildingInsights(point) {
      const q = new URLSearchParams({
        'location.latitude': String(point.lat),
        'location.longitude': String(point.lng),
        requiredQuality: 'MEDIUM',
        key: apiKey,
      });
      const response = await fetchFn(`${INSIGHTS_URL}?${q}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Solar API answered ${response.status}`);
      return (await response.json()) as GoogleSolarBuildingInsights;
    },
  };
}

/** What the session keeps of Google's roof. */
export interface GoogleRoof {
  source: 'google';
  /** Panels on the south, east and west faces of Google's largest layout. */
  usablePanels: number;
  pitchDeg: number;
  /** MCS convention: degrees from due south. */
  mcsOrientationDeg: number;
  panelCapacityWatts: number;
  imageryQuality: string;
  imageryYear: number | null;
  /** Google's layouts as [panels, yearly DC kWh], smallest first. */
  layouts: Array<[number, number]>;
}

/** Metres between two points (equirectangular: fine at a building's scale). */
export function metresBetween(a: LatLngPoint, b: LatLngPoint): number {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** Google's response, cut down to what a quote needs. Null without panel layouts. */
export function compactInsights(insights: GoogleSolarBuildingInsights): GoogleRoof | null {
  const potential = insights.solarPotential;
  const configs = potential?.solarPanelConfigs ?? [];
  if (configs.length === 0) return null;
  const geometry = deriveGeometry(insights, null);
  const layouts = configs
    .map((c): [number, number] => [c.panelsCount, Math.round(c.yearlyEnergyDcKwh)])
    .sort((a, b) => a[0] - b[0]);
  return {
    source: 'google',
    usablePanels: usableGoogleSolarPanelCount(insights),
    pitchDeg: geometry.pitchDeg,
    mcsOrientationDeg: geometry.mcsOrientationDeg,
    panelCapacityWatts: potential.panelCapacityWatts,
    imageryQuality: insights.imageryQuality,
    imageryYear: insights.imageryDate?.year ?? null,
    layouts,
  };
}

/**
 * The compact roof back as the engine's insights type. Only the layouts and
 * the panel wattage are read on the pricing path (`evaluateConfig`), so the
 * rest is left empty.
 */
export function insightsFromRoof(roof: GoogleRoof): GoogleSolarBuildingInsights {
  return {
    imageryQuality: roof.imageryQuality,
    solarPotential: {
      panelCapacityWatts: roof.panelCapacityWatts,
      roofSegmentStats: [],
      solarPanelConfigs: roof.layouts.map(([panelsCount, yearlyEnergyDcKwh]) => ({
        panelsCount,
        yearlyEnergyDcKwh,
        roofSegmentSummaries: [],
      })),
    },
  } as unknown as GoogleSolarBuildingInsights;
}

/** Yearly DC kWh per panel for a system of this size, from Google's nearest layout. */
export function perPanelDcKwh(roof: GoogleRoof, panels: number): number | null {
  if (roof.layouts.length === 0) return null;
  const nearest = roof.layouts.reduce((best, l) =>
    Math.abs(l[0] - panels) < Math.abs(best[0] - panels) ? l : best,
  );
  return nearest[1] / Math.max(1, nearest[0]);
}

/** Read a stored roof back, or null when it is absent or not Google's. */
export function parseGoogleRoof(raw: string | undefined): GoogleRoof | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<GoogleRoof>;
    if (value.source !== 'google' || !Array.isArray(value.layouts)) return null;
    if (typeof value.usablePanels !== 'number' || typeof value.pitchDeg !== 'number') return null;
    return value as GoogleRoof;
  } catch {
    return null;
  }
}

/** The address's roof from Google, or null when Google cannot be sure it is this home. */
export async function lookUpGoogleRoof(
  client: SolarClient,
  address: string,
): Promise<GoogleRoof | null> {
  const point = await client.geocode(address);
  if (!point) return null;
  const insights = await client.buildingInsights(point);
  if (!insights) return null;
  const centre = insights.center
    ? { lat: insights.center.latitude, lng: insights.center.longitude }
    : null;
  if (centre && metresBetween(point, centre) > MAX_BUILDING_DISTANCE_M) return null;
  return compactInsights(insights);
}
