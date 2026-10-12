// Facade/roof materials: OSM building:material / roof:material / colour tags, else UK defaults by era and nation.
import type { BuildingPartSpec, Era, Nation, RoofMaterial, RoofType, WallMaterial } from '@sunny/sunscan-core';

const WALL_TAGS: Record<string, WallMaterial> = {
  brick: 'brick', bricks: 'brick', clinker: 'brick',
  stone: 'stone', sandstone: 'stone', limestone: 'stone', granite: 'stone', flint: 'stone', slate: 'stone', marble: 'stone', cob: 'render',
  wood: 'timber', timber: 'timber', timber_framing: 'timber', log: 'timber',
  plaster: 'render', render: 'render', stucco: 'render', concrete: 'render', cement_block: 'render', harling: 'render', roughcast: 'render',
  pebbledash: 'pebbledash', pebble_dash: 'pebbledash',
};

const ROOF_TAGS: Record<string, RoofMaterial> = {
  roof_tiles: 'tile', tile: 'tile', tiles: 'tile', clay: 'tile', concrete: 'tile', thatch: 'tile', wood: 'tile', stone: 'slate',
  slate: 'slate', metal: 'slate', copper: 'slate', zinc: 'slate', lead: 'slate', eternit: 'slate', glass: 'slate',
  tar_paper: 'flat', asphalt: 'flat', gravel: 'flat', grass: 'flat', plants: 'flat', bitumen: 'flat', felt: 'flat',
};

/** Material of the default wall by nation and era (research 05 §5 typology; ASSUMPTION, editable in the UI). */
export function defaultWall(era: Era, nation: Nation | undefined): WallMaterial {
  if (nation === 'Scotland') return era === 'pre-1919' || era === '1919-1944' ? 'stone' : 'render';
  if (nation === 'Northern Ireland') return 'render';
  if (nation === 'Wales') return era === 'pre-1919' ? 'render' : 'brick';
  return 'brick';
}

/** Default roof covering: slate before 1919 (and in Scotland/Wales), clay/concrete tiles afterwards. */
export function defaultRoof(era: Era, nation: Nation | undefined): RoofMaterial {
  if (nation === 'Scotland' || nation === 'Wales') return 'slate';
  return era === 'pre-1919' ? 'slate' : 'tile';
}

/** Normalise an OSM colour value ('red', '#A33', 'brown') into a CSS colour string, or undefined. */
export function cssColour(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(s)) return s;
  if (/^[a-z]{3,20}$/.test(s)) return s;
  return undefined;
}

/**
 * Part materials from OSM tags (building:material, building:facade:material, roof:material, building:colour,
 * roof:colour) falling back to UK defaults for the era and nation; flat roofs always get the 'flat' covering.
 */
export function materialsFor(tags: Record<string, string>, era: Era, nation: Nation | undefined, roofType: RoofType): BuildingPartSpec['material'] {
  const wallTag = (tags['building:material'] ?? tags['building:facade:material'] ?? tags['facade:material'])?.toLowerCase();
  const roofTag = tags['roof:material']?.toLowerCase();
  const wall = (wallTag && WALL_TAGS[wallTag]) || defaultWall(era, nation);
  const roof: RoofMaterial = roofType === 'flat' ? 'flat' : (roofTag && ROOF_TAGS[roofTag] !== 'flat' ? ROOF_TAGS[roofTag] : undefined) ?? defaultRoof(era, nation);
  const wallColour = cssColour(tags['building:colour'] ?? tags['building:facade:colour']);
  const roofColour = cssColour(tags['roof:colour']);
  return { wall, roof, ...(wallColour ? { wallColour } : {}), ...(roofColour ? { roofColour } : {}) };
}
