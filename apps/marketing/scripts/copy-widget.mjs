import { fileURLToPath } from 'node:url';

import { copyWidgetBundle } from '../../../scripts/widget-bundle.mjs';

/**
 * Copy the built widget next to the marketing site.
 *
 * The marketing site embeds the real widget — the same file an integrator would
 * load — rather than a picture of it. Serving it from the site's own origin is
 * what the embed snippet promises, and it means a visitor to the marketing page
 * is exercising the same code path as a customer's visitor.
 *
 * The bundle and the typeface beside it are one unit, so the copying itself is
 * shared with the other host that serves the widget: see
 * `scripts/widget-bundle.mjs` for what has to travel together and why.
 */
copyWidgetBundle(fileURLToPath(new URL('../public/widget', import.meta.url)), 'marketing');
