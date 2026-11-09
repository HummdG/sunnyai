/**
 * The installer's logo, animated: `sunny-logo.js`, beside the widget. A file of
 * its own so a Sunny tenant's visitors never download the effects, and the
 * widget's budget stays the widget's. Until it loads, the widget shows the logo
 * as a plain image, which is exactly what this draws at rest.
 */
export { createLogoView } from '@sunny/logo-effects';
export type { LogoView } from '@sunny/logo-effects';
