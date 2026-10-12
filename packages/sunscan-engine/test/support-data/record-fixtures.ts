// Records (or smoke-tests live) the HTTP fixtures used by the replay tests.
//   npx tsx apps/server/test/support-data/record-fixtures.ts [--mode record|live|replay] [--prune] [slug ...]
// For every test address: geocodeUk(query) -> fetchBuildings(best point + osmRef) -> core built form ->
// getSurfaceRasters(target + neighbours within 50 m, +14 m) -> nationAt(best point and target centroid) -> the Esri
// z19 tiles of the aerial ground texture (±(60 + 15) m around the target centroid, so the registered origin's ±60 m
// square stays covered); plus the suggest prefixes, the research geocoder variants and one imagery tile. Respects
// provider rate limits (HTTP layer). --prune deletes fixtures not used by this run.
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { frameAtCentroid } from '@sunny/sunscan-core/footprint';
import { fetchBuildings } from '../../src/buildings/index.js';
import { elevationBboxForBuildings, getOstn15, getSurfaceRasters, gridBounds } from '../../src/elevation/index.js';
import { geocodeUk, nationAt, suggestUk } from '../../src/geocode/index.js';
import { getHttpConfig, getHttpLog, getHttpStats, parseHttpMode, setHttpMode } from '../../src/http/index.js';
import { ORTHO_DEFAULT_HALF, ORTHO_ZOOM, tilesForSquare } from '../../src/imagery/ortho.js';
import { getImageryTile } from '../../src/providers/index.js';
import { analyseTarget } from './analysis.js';
import { EXPECTED, GEOCODE_VARIANTS, IMAGERY_TILE, loadTestAddresses, SUGGEST_PREFIXES } from './expectations.js';

const args = process.argv.slice(2);
const modeArg = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'record';
const prune = args.includes('--prune');
const slugs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--mode');
setHttpMode(parseHttpMode(modeArg));
const ok = (b: boolean) => (b ? 'OK ' : 'XX ');
const problems: string[] = [];

async function runAddress(slug: string, query: string): Promise<void> {
  const exp = EXPECTED[slug];
  const t0 = Date.now();
  const g = await geocodeUk(query);
  const best = g.best;
  console.log(`\n== ${slug}: "${query}"\n   geocode ${g.confidence} ${best?.osmRef ?? '-'} score ${best?.score} [${best?.sources.join('+')}] ${Date.now() - t0} ms`);
  if (best?.osmRef !== exp.osmRef || g.confidence !== 'high') problems.push(`${slug}: geocode ${g.confidence} ${best?.osmRef}`);
  if (!best) return;
  const t1 = Date.now();
  const b = await fetchBuildings({ lat: best.lat, lon: best.lon, ...(best.osmRef ? { osmRef: best.osmRef } : {}), parsed: g.parsed });
  const counts = b.buildings.reduce<Record<string, number>>((m, x) => ((m[x.isPart ? `${x.source}-part` : x.source] = (m[x.isPart ? `${x.source}-part` : x.source] ?? 0) + 1), m), {});
  console.log(`   buildings target ${b.target} ambiguous ${b.ambiguous} ${JSON.stringify(counts)} roads ${b.roads.length} entrances ${b.entrances.length} ${b.sources.join(', ')} ${Date.now() - t1} ms`);
  for (const w of b.warnings.slice(0, 4)) console.log(`   ! ${w}`);
  if (b.target !== `osm:${exp.osmRef}`) problems.push(`${slug}: target ${b.target}`);
  const osmOnly = analyseTarget(b, ['osm']);
  const merged = analyseTarget(b);
  console.log(`   ${ok(osmOnly.builtForm === exp.builtForm)}built form OSM-only ${osmOnly.builtForm}; ${ok(merged.builtForm === exp.builtForm)}with Overture ${merged.builtForm} (attached ${merged.attached.join(', ') || '-'})`);
  if (merged.builtForm !== exp.builtForm) problems.push(`${slug}: built form ${merged.builtForm} (osm-only ${osmOnly.builtForm})`);
  const ostn = await getOstn15();
  const bbox = elevationBboxForBuildings(b, ostn);
  const t2 = Date.now();
  const r = await getSurfaceRasters({ bbox, nation: g.postcode?.nation ?? exp.nation });
  if ('dsm' in r) {
    const gb = gridBounds(r.dsm);
    console.log(`   lidar ${r.source.id} cov ${(r.coverage * 100).toFixed(1)} % ${r.dsm.width}x${r.dsm.height}@${r.dsm.res} m [${gb.minE},${gb.minN},${gb.maxE},${gb.maxN}] last ${!!r.dsmLast} dates ${r.source.surveyDates?.join(',') ?? '-'} q[${r.quality.join(',')}] ${Date.now() - t2} ms`);
    if (r.source.id !== exp.lidarSource || r.coverage < 0.95) problems.push(`${slug}: lidar ${r.source.id} ${r.coverage}`);
  } else {
    console.log(`   lidar NONE ${r.reason} ${r.detail ?? ''}`);
    problems.push(`${slug}: lidar ${r.reason}`);
  }
  const target = b.buildings.find((x) => x.ref === b.target)!;
  const c = frameAtCentroid(target.outer, target.holes);
  const n1 = await nationAt(best.lat, best.lon);
  const n2 = await nationAt(c.lat0, c.lon0);
  console.log(`   nation ${n1} / ${n2}`);
  if (n1 !== exp.nation || n2 !== exp.nation) problems.push(`${slug}: nation ${n1}/${n2}`);
  const tiles = tilesForSquare(c.lat0, c.lon0, ORTHO_DEFAULT_HALF + 15);
  let got = 0;
  for (const t of tiles) if (await getImageryTile(ORTHO_ZOOM, t.x, t.y)) got++;
  console.log(`   imagery ${got}/${tiles.length} z${ORTHO_ZOOM} tiles`);
  if (got < tiles.length) problems.push(`${slug}: imagery ${got}/${tiles.length} tiles`);
}

async function inventory(used: Set<string>): Promise<void> {
  const root = getHttpConfig().fixturesDir;
  let files = 0;
  let bytes = 0;
  const per: Record<string, { n: number; bytes: number }> = {};
  const stale: string[] = [];
  for (const prov of await readdir(root).catch(() => [] as string[])) {
    for (const f of await readdir(path.join(root, prov))) {
      const p = path.join(root, prov, f);
      const s = await stat(p);
      const key = f.replace(/\.(json|bin)$/, '');
      if (!used.has(key)) stale.push(p);
      files++;
      bytes += s.size;
      per[prov] = { n: (per[prov]?.n ?? 0) + 1, bytes: (per[prov]?.bytes ?? 0) + s.size };
    }
  }
  console.log(`\nfixtures: ${files} files, ${(bytes / 1e6).toFixed(2)} MB`);
  for (const [k, v] of Object.entries(per)) console.log(`   ${k.padEnd(14)} ${String(v.n).padStart(5)} files ${(v.bytes / 1e6).toFixed(2).padStart(7)} MB`);
  if (stale.length) console.log(`   ${stale.length} file(s) not used by this run${prune ? ': deleted' : ' (use --prune to delete)'}`);
  if (prune) for (const p of stale) await unlink(p);
}

const addresses = loadTestAddresses().filter((a) => !slugs.length || slugs.includes(a.slug));
console.log(`mode ${modeArg}, ${addresses.length} address(es), fixtures ${getHttpConfig().fixturesDir}`);
for (const a of addresses) {
  try {
    await runAddress(a.slug, a.query);
  } catch (e) {
    problems.push(`${a.slug}: ${(e as Error).message}`);
    console.log(`   ERROR ${(e as Error).stack}`);
  }
}
if (!slugs.length) {
  for (const [prefix] of SUGGEST_PREFIXES) {
    const s = await suggestUk(prefix);
    console.log(`\nsuggest "${prefix}": ${s.slice(0, 4).map((x) => `${x.kind}:${x.label}`).join(' | ')}`);
  }
  for (const [input, ref, confidence] of GEOCODE_VARIANTS) {
    const g = await geocodeUk(input);
    const hit = ref ? g.best?.osmRef === ref : g.best?.level === 'postcode';
    console.log(`${ok(hit && g.confidence === confidence)}variant "${input}" -> ${g.confidence} ${g.best?.osmRef ?? g.best?.label}`);
    if (!hit || g.confidence !== confidence) problems.push(`variant "${input}": ${g.confidence} ${g.best?.osmRef}`);
  }
  const t = IMAGERY_TILE;
  const tile = await getImageryTile(t.z, t.x, t.y);
  console.log(`\nimagery tile ${t.z}/${t.x}/${t.y}: ${tile ? `${tile.contentType} ${tile.body.byteLength} B` : 'unavailable'}`);
  if (!tile) problems.push('imagery tile unavailable');
}
console.log('\nhttp stats', JSON.stringify(getHttpStats()));
if (modeArg !== 'live' && !slugs.length) await inventory(new Set(getHttpLog().map((e) => e.key)));
console.log(problems.length ? `\nPROBLEMS:\n - ${problems.join('\n - ')}` : '\nall expectations met');
