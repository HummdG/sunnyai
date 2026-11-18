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
const DATA_LAYERS_URL = 'https://solar.googleapis.com/v1/dataLayers:get';
/** The photo is fetched after the reply, off the conversation's path, so it may take longer. */
const IMAGE_TIMEOUT_MS = 10_000;
/** Google's layer links last an hour; the answer is shared for a while less. */
const LAYERS_TTL_MS = 10 * 60 * 1000;

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
  /**
   * Google's aerial photo around a point, as the bytes of its RGB GeoTIFF, or
   * null when Google has no imagery there. Optional: a client without it shows
   * no photo.
   */
  aerialImage?(point: LatLngPoint, radiusM: number): Promise<ArrayBuffer | null>;
  /**
   * Google's height model round the same point and, when it has one, its mask
   * of which pixels are building (both GeoTIFFs), for marking each roof face
   * on the photo. Optional, and null without one: the photo is then shown plain.
   */
  roofHeights?(point: LatLngPoint, radiusM: number): Promise<RoofHeights | null>;
}

export interface RoofHeights {
  dsm: ArrayBuffer;
  mask: ArrayBuffer | null;
}

/** Google over HTTP. A 404 from the Solar API means no model here, not an error. */
export function httpSolarClient(apiKey: string, fetchFn: typeof fetch = fetch): SolarClient {
  const client: SolarClient = {
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
    async aerialImage(point, radiusM) {
      const found = await layers(point, radiusM);
      return found?.rgbUrl ? download(found.rgbUrl) : null;
    },
    async roofHeights(point, radiusM) {
      const found = await layers(point, radiusM);
      if (!found?.dsmUrl) return null;
      const [dsm, mask] = await Promise.all([
        download(found.dsmUrl),
        found.maskUrl ? download(found.maskUrl).catch(() => null) : Promise.resolve(null),
      ]);
      return { dsm, mask };
    },
  };

  /**
   * One `dataLayers` request answers for the photo, the heights and the
   * building mask (it is the request that is billed, not the downloads), so
   * it is made once per place and shared for as long as its links last.
   */
  type Layers = { rgbUrl?: string; dsmUrl?: string; maskUrl?: string };
  const recent = new Map<string, { at: number; found: Promise<Layers | null> }>();
  function layers(point: LatLngPoint, radiusM: number): Promise<Layers | null> {
    const key = `${point.lat},${point.lng},${Math.round(radiusM)}`;
    const hit = recent.get(key);
    if (hit && Date.now() - hit.at < LAYERS_TTL_MS) return hit.found;
    const found = (async () => {
      const q = new URLSearchParams({
        'location.latitude': String(point.lat),
        'location.longitude': String(point.lng),
        radiusMeters: String(Math.round(radiusM)),
        view: 'IMAGERY_LAYERS',
        requiredQuality: 'MEDIUM',
        pixelSizeMeters: '0.1',
        key: apiKey,
      });
      const response = await fetchFn(`${DATA_LAYERS_URL}?${q}`, {
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Solar API data layers answered ${response.status}`);
      return (await response.json()) as Layers;
    })();
    if (recent.size >= 20) recent.delete(recent.keys().next().value!);
    recent.set(key, { at: Date.now(), found });
    // A failure is not kept: the next ask tries again.
    found.catch(() => recent.delete(key));
    return found;
  }
  async function download(layerUrl: string): Promise<ArrayBuffer> {
    const url = new URL(layerUrl);
    url.searchParams.set('key', apiKey);
    const tiff = await fetchFn(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
    if (!tiff.ok) throw new Error(`Solar API imagery answered ${tiff.status}`);
    return tiff.arrayBuffer();
  }

  return client;
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
  /**
   * Where the building and its panels sit, for the aerial photo the visitor
   * is shown (`roof-image.ts`). Absent on roofs saved before it existed.
   */
  view?: RoofView;
}

/** The building, its roof faces and Google's largest panel layout, by position. */
export interface RoofView {
  centre: LatLngPoint;
  box: { sw: LatLngPoint; ne: LatLngPoint };
  /** Panel size in metres, as laid out on the roof (before the pitch). */
  panelWidthM: number;
  panelHeightM: number;
  /** Roof faces in Google's order (a panel's `face` is an index into this). */
  faces: Array<{
    pitchDeg: number;
    azimuthDeg: number;
    areaM2: number;
    /**
     * Where the face's plane sits: its centre as [lat, lng], its height there
     * in metres, and its box as [south, west, north, east]. With these and
     * Google's height model each face can be marked on the photo. Absent on
     * roofs saved before they were kept.
     */
    centre?: [number, number];
    heightM?: number;
    box?: [number, number, number, number];
  }>;
  /** Panels as [lat, lng, face, portrait ? 1 : 0], Google's best first. */
  panels: Array<[number, number, number, 0 | 1]>;
}

/** Google's panels are many; the photo needs only enough to show the layout. */
const MAX_VIEW_PANELS = 160;

/** The view of a building Google modelled, or undefined without panels or a box. */
export function roofViewOf(insights: GoogleSolarBuildingInsights): RoofView | undefined {
  const potential = insights.solarPotential;
  const box = insights.boundingBox;
  const panels = potential?.solarPanels ?? [];
  if (!box || !insights.center || panels.length === 0) return undefined;
  const round = (n: number) => Math.round(n * 1e7) / 1e7;
  const point = (p: { latitude: number; longitude: number }): LatLngPoint => ({
    lat: round(p.latitude),
    lng: round(p.longitude),
  });
  return {
    centre: point(insights.center),
    box: { sw: point(box.sw), ne: point(box.ne) },
    panelWidthM: potential.panelWidthMeters,
    panelHeightM: potential.panelHeightMeters,
    faces: potential.roofSegmentStats.map((s) => ({
      pitchDeg: Math.round(s.pitchDegrees * 10) / 10,
      azimuthDeg: Math.round(s.azimuthDegrees * 10) / 10,
      areaM2: Math.round(s.stats.areaMeters2 * 10) / 10,
      ...(s.center && s.boundingBox && typeof s.planeHeightAtCenterMeters === 'number'
        ? {
            centre: [round(s.center.latitude), round(s.center.longitude)] as [number, number],
            heightM: Math.round(s.planeHeightAtCenterMeters * 100) / 100,
            box: [
              round(s.boundingBox.sw.latitude),
              round(s.boundingBox.sw.longitude),
              round(s.boundingBox.ne.latitude),
              round(s.boundingBox.ne.longitude),
            ] as [number, number, number, number],
          }
        : {}),
    })),
    panels: panels
      .slice(0, MAX_VIEW_PANELS)
      .map((p) => [
        round(p.center.latitude),
        round(p.center.longitude),
        p.segmentIndex,
        p.orientation === 'PORTRAIT' ? 1 : 0,
      ]),
  };
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
  const view = roofViewOf(insights);
  return {
    ...(view ? { view } : {}),
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
