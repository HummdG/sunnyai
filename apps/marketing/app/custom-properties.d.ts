/**
 * `style={{ '--anything': … }}` in JSX.
 *
 * React's `CSSProperties` is a closed type — it lists the CSS properties and
 * nothing else — so a custom property is an error in a `style` object even
 * though the DOM accepts it and the CSS parser would. React's own documentation
 * gives this augmentation as the way to open it, and it is scoped to custom
 * properties rather than to `style` as a whole: `'--x'` is accepted, a
 * misspelled `'font-famly'` still is not.
 *
 * The site needs it because the token layer and the font loader disagree about
 * who owns `--font-sans` — `tokens.css` sets it on `:root`, `next/font` computes
 * a family name at build time, and the layout joins them on the `<html>` element,
 * where an inline declaration wins by construction rather than by stylesheet
 * order (D-48).
 */
declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}

export {};
