import { fileURLToPath } from 'node:url';

import { copyWidgetBundle } from '../../../scripts/widget-bundle.mjs';

/**
 * Copy the built widget where Next can serve it.
 *
 * This is the fixture's stand-in for a CDN. An integrator's Next site would
 * either point the snippet at a hosted bundle or serve it from `public/`, and
 * serving it from `public/` is the one that needs no network and no second
 * origin — which matters, because the thing under test is the widget, not the
 * fixture's infrastructure.
 *
 * Serving it from `public/` is also what makes the typeface part of this job
 * rather than a detail: the widget resolves its font against the directory its
 * own script was served from, so a fixture that copies the script alone is a
 * fixture whose widget silently renders in the system stack. That is what
 * `scripts/widget-bundle.mjs` exists for, and this fixture is why it is shared
 * rather than written out twice.
 */
copyWidgetBundle(fileURLToPath(new URL('../public/widget', import.meta.url)), 'widget-demo-next');
