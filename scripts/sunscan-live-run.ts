/**
 * Run the vendored SunScan engine against live open UK data for a list of
 * addresses and print a results table (JSON lines + a summary).
 *
 *   npx tsx scripts/sunscan-live-run.ts [--mode live|record|replay] [--fixtures DIR] [--cache DIR] "address" ...
 *
 * `record` also writes every provider response under --fixtures, so an address
 * that works live can be replayed in tests and demos with no network. The
 * engine paces each host itself (Nominatim at one request a second) and sends
 * an identifying, contact-free User-Agent (override with SUNSCAN_USER_AGENT).
 */
import { createSunScanEngine, SunScanError } from '@sunny/sunscan-adapter';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}
const mode = (flag('--mode') ?? 'live') as 'live' | 'record' | 'replay';
const fixturesDir = flag('--fixtures');
const cacheDir = flag('--cache');
const addresses = args.length > 0 ? args : ['20 Forthlin Road, Liverpool L18 9TN'];

const engine = createSunScanEngine({
  httpMode: mode,
  ...(fixturesDir ? { fixturesDir } : {}),
  ...(cacheDir ? { cacheDir } : {}),
  ...(process.env['SUNSCAN_USER_AGENT'] ? { userAgent: process.env['SUNSCAN_USER_AGENT'] } : {}),
});

for (const address of addresses) {
  const started = performance.now();
  try {
    const outcome = await engine.assess({ address });
    const s = outcome.summary;
    console.log(
      JSON.stringify({
        address,
        ok: true,
        seconds: Math.round((performance.now() - started) / 100) / 10,
        geocode: s.confidence.geocode,
        roof: s.confidence.roof,
        reliable: s.reliable,
        builtForm: s.builtForm,
        roofType: s.roofType,
        planes: s.roofPlanes.map((p) => ({
          facing: p.facing,
          pitchDeg: Math.round(p.pitchDeg),
          areaM2: Math.round(p.areaM2),
          usableM2: Math.round(p.usableAreaM2),
          maxPanels: p.maxPanels,
          suitable: p.suitable,
        })),
        usableRoofAreaM2: Math.round(s.usableRoofAreaM2),
        estimatedMaxPanels: s.estimatedMaxPanels,
        bestFacing: s.bestFacing,
        flags: s.flags,
        glbBytes: outcome.glb.byteLength,
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        address,
        ok: false,
        seconds: Math.round((performance.now() - started) / 100) / 10,
        code: e instanceof SunScanError ? e.code : 'unexpected',
        message: (e as Error).message,
      }),
    );
  }
}
