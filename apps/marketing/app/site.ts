/**
 * Site content that is configuration rather than copy: navigation and plans.
 *
 * Plan §15 lists subscription prices and plan limits as commercial decisions to
 * expose as configuration. They live here so changing a price is a one-line
 * edit, not a page rewrite.
 */

export const NAV = [
  { href: '/product', label: 'Product' },
  { href: '/meet-sunny', label: 'Meet Sunny' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/resources', label: 'Resources' },
] as const;

export interface Plan {
  name: string;
  /** Monthly price, in PRICING_CURRENCY, excluding tax. Add-ons are on top of Base. */
  monthly: number;
  summary: string;
  features: readonly string[];
  highlighted?: boolean;
}

/**
 * Packages and prices from the Blueprint (§6.3, "SaaS Pricing & Profit Margin
 * Summary"): the web chat is the base package and email and voice are add-ons.
 *
 * The owner confirmed the figures (2026-10-20) and that they are in pounds:
 * Sunny sells to UK installers. The Stripe price ids the portal charges
 * against are separate configuration (STRIPE_PRICE_* on the API), and must be
 * created in GBP at the same amounts.
 */
export const PRICING_IS_PLACEHOLDER = false;
export const PRICING_CURRENCY = 'GBP';

export const PLANS: readonly Plan[] = [
  {
    name: 'Base',
    monthly: 199,
    summary: 'Sunny on your website, answering from your own website and documents.',
    features: [
      'AI chat assistant on your website',
      'Learns from your website and Google Drive',
      'Lead capture with consent',
      'Unified inbox and lead export',
    ],
    highlighted: true,
  },
  {
    name: 'Email Assistant',
    monthly: 99,
    summary: 'Add-on to Base: Sunny drafts grounded replies in your sales inbox.',
    features: [
      'Gmail or Outlook, or email forwarding',
      'Drafts for one-click approval',
      'Attaches your spec sheets',
      'Same knowledge, same guardrails',
    ],
  },
  {
    name: 'Voice & Phone',
    monthly: 199,
    summary: 'Add-on to Base: speak to Sunny on your site, and on the phone.',
    features: [
      'Microphone in the website chat',
      'AI phone receptionist, 24/7',
      'Includes 500 call minutes',
      'Hands over to your team',
    ],
  },
  {
    name: 'Full Suite',
    monthly: 449,
    summary: 'Chat, email and voice together, on one knowledge base.',
    features: [
      'Everything in Base',
      'Email Assistant',
      'Voice & Phone',
      'One inbox for every channel',
    ],
  },
];

export function formatPrice(monthly: number): string {
  return `£${monthly.toLocaleString('en-GB')}`;
}

/**
 * Who runs Sunny, for the privacy policy and the terms. **Fill these in before
 * launch:** the bracketed values are placeholders, and the legal pages print
 * them as they are, so a missing detail shows rather than hiding.
 */
export const LEGAL = {
  tradingName: 'Sunny.ai',
  companyName: '[Registered company name]',
  companyNumber: '[Company number]',
  registeredAddress: '[Registered office address]',
  contactEmail: '[Contact email address]',
  icoNumber: '[ICO registration number]',
  /** The date both pages say they were last updated. */
  updated: '21 October 2026',
} as const;
