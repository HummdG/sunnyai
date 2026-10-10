/**
 * The public site's two runtime values.
 *
 * The demo widget is the real widget, so it needs a real API and a real public
 * id. Both are read from the environment at build time, because a deployed
 * marketing site must point at the deployed API — a hard-coded
 * `localhost` would ship a demo that does nothing. The defaults keep a local
 * `npm run dev` working with no configuration.
 */
export const PUBLIC_ID = process.env.NEXT_PUBLIC_SUNNY_WIDGET_ID ?? 'w_demo000001';

export const API_URL = process.env.NEXT_PUBLIC_SUNNY_API_URL ?? 'http://localhost:8787';
