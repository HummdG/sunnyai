/**
 * A Next.js host fixture for the widget.
 *
 * The plan asks for three fixtures -- plain HTML, React and Next.js -- because a
 * widget that works in one host shape is not evidence that it works in another,
 * and the transcript of every "it worked in testing" story contains a framework
 * nobody tried. The React fixture proved that; this one exists because Next adds
 * a second hoisting layer on top of React's, and an integrator's first attempt
 * will be `next/script`.
 *
 * The two routes deliberately use the two integrations a real integrator picks
 * between:
 *
 *   /         our documented snippet, pasted into a component as-is
 *   /script   `next/script`, which is what Next's own docs recommend
 *
 * They place the script tag differently and Next treats them differently, so
 * "it works" has to mean both.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
