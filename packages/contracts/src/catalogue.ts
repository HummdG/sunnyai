import { z } from 'zod';

/**
 * The installer's catalogue, and the shape of a recommendation built from it.
 *
 * Three rules from the plan are load-bearing here, and they are why so much of
 * this is nullable rather than optional-with-a-default:
 *
 *   - **Missing fields stay null, never inferred.** A panel whose wattage nobody
 *     typed is not a 400 W panel; it is a row with no wattage. Everything the
 *     catalogue does not know is `null`, so a rule that needs a number can tell
 *     "absent" from "given" and skip the check rather than invent an input for
 *     it. The same distinction is kept between an empty list and a null one: a
 *     battery that works with no inverter is a fact, and a battery whose
 *     pairings nobody filled in is not that fact.
 *   - **Every price is the installer's.** Nothing in a recommendation is ours:
 *     not a range, not a typical figure, not a number derived from the visitor's
 *     budget band. That is why a package's total goes `null` the moment one of
 *     its items has no price -- a total built from five known items and one
 *     unknown one is not a total.
 *   - **Provenance travels with the row.** `sourceRef` and `sourceVersion` are
 *     what let a price be shown as verified rather than indicative. Keeping
 *     them on the record rather than beside it is what makes "where did this
 *     number come from" answerable a year later.
 */

/** What a catalogue row is. Not a closed taxonomy: `other` exists to be honest. */
export const PRODUCT_CATEGORIES = [
  'panel',
  'inverter',
  'battery',
  'ev_charger',
  'mounting',
  'other',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/**
 * How much a price can be trusted, which is a fact about its provenance rather
 * than about its size.
 *
 * `verified` -- the installer's own row, carrying a reference to what it came
 * from. `indicative` -- priced, but with nothing saying where the figure was
 * read. `unknown` -- no price at all.
 */
export const PRICE_STATUSES = ['verified', 'indicative', 'unknown'] as const;

export type PriceStatus = (typeof PRICE_STATUSES)[number];

/**
 * The attributes the compatibility rules read, one flat bag per product.
 *
 * Flat rather than a discriminated union per category because a row is allowed
 * to be *partial*: an installer's spreadsheet may know a battery's capacity and
 * nothing about which inverters accept it, and that row has to be storable as
 * itself rather than as a broken battery. Each rule reads the fields it needs
 * and reports `skipped-missing-data` when they are null, so an absent attribute
 * costs a check rather than producing a verdict.
 *
 * The vocabulary is deliberately narrow: these are the fields a rule here
 * actually consumes. Anything an installer wants to record that no rule reads
 * belongs in `notes`, where it is visible to a human and cannot be mistaken for
 * something the engine took into account.
 */
export const compatibilitySchema = z.object({
  /** Panels: open-circuit voltage (V) from the datasheet. */
  vocV: z.number().positive().nullable().default(null),
  /** Panels: short-circuit current (A) from the datasheet. */
  iscA: z.number().positive().nullable().default(null),
  /** Inverters: maximum DC input power (W) the unit will accept. */
  maxDcPowerW: z.number().int().positive().nullable().default(null),
  /** Inverters: highest string voltage (V) the unit will accept. */
  maxStringVoltageV: z.number().int().positive().nullable().default(null),
  /** Inverters: how many independent string inputs the unit has. */
  mpptCount: z.number().int().positive().nullable().default(null),
  /** Inverters and EV chargers: single- or three-phase. */
  phase: z
    .union([z.literal(1), z.literal(3)])
    .nullable()
    .default(null),
  /** Inverters: whether it can charge a battery without a separate unit. */
  hybrid: z.boolean().nullable().default(null),
  /**
   * Inverters: battery families this unit accepts. Matched case-insensitively
   * against a battery's `batteryFamily`, because two rows typed by two people
   * are the normal case and "Powerwall 3" and "powerwall 3" are one product.
   */
  batteryFamilies: z.array(z.string().min(1).max(120)).nullable().default(null),
  /** Batteries: the family this unit belongs to, matched as above. */
  batteryFamily: z.string().min(1).max(120).nullable().default(null),
  /** Batteries: specific inverter models this unit is known to work with. */
  inverterModels: z.array(z.string().min(1).max(120)).nullable().default(null),
});

export type Compatibility = z.infer<typeof compatibilitySchema>;

/**
 * One product, as stored.
 *
 * `id` and `tenantId` are assigned by the server on the way in and are never
 * read from an uploaded file: a catalogue that could name its own tenant would
 * be a way to write into someone else's.
 */
export const productSchema = z.object({
  id: z.string().min(1).max(80),
  tenantId: z.string().min(1).max(80),
  category: z.enum(PRODUCT_CATEGORIES),
  manufacturer: z.string().min(1).max(120),
  model: z.string().min(1).max(120),
  /**
   * Watts. A panel's rating, or an inverter's rated output. Both are what the
   * row says, in the unit the datasheet uses, and never converted from a
   * related figure -- a panel quoted in kWp is a row to fix, not one to divide
   * by a thousand on the installer's behalf.
   */
  powerW: z.number().int().positive().nullable().default(null),
  /** Watt-hours of capacity, as the row gives it. */
  capacityWh: z.number().int().positive().nullable().default(null),
  /** Integer minor units -- pence, cents -- so no price is ever a float. */
  priceMinor: z.number().int().nonnegative().nullable().default(null),
  /** ISO 4217, upper case. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .default(null),
  priceStatus: z.enum(PRICE_STATUSES).default('unknown'),
  warrantyYears: z.number().int().nonnegative().nullable().default(null),
  compatibility: compatibilitySchema.default({}),
  /** Where the row came from: a datasheet URL, a price-list document id. */
  sourceRef: z.string().min(1).max(500).nullable().default(null),
  /** Which revision of that source, so a stale price is visible as stale. */
  sourceVersion: z.string().min(1).max(120).nullable().default(null),
  documentRefs: z.array(z.string().min(1).max(500)).default([]),
  imageUrl: z.string().min(1).max(500).nullable().default(null),
  /** Free text for humans. No rule reads this, by design. */
  notes: z.string().max(1000).nullable().default(null),
  /** 1-based line in the uploaded file, so an error can be pointed at. */
  rowNumber: z.number().int().positive().nullable().default(null),
  createdAt: z.string().min(1),
});

export type Product = z.infer<typeof productSchema>;

/**
 * What can go wrong with one row, and how badly.
 *
 * `error` rejects the row; `warning` stores it and says what is missing. The
 * split is the difference between a row we cannot read (no model, two prices,
 * a currency we would have to guess) and a row that is merely thin (no
 * warranty, no provenance). Only the first should make an installer fix their
 * file before it will import.
 */
export const CATALOGUE_ISSUE_CODES = [
  'empty-file',
  'unterminated-quote',
  'duplicate-column',
  'unknown-category',
  'missing-manufacturer',
  'missing-model',
  'model-not-an-identifier',
  'duplicate-in-file',
  'duplicate-in-catalogue',
  'unreadable-number',
  'unreadable-unit',
  'missing-unit',
  'price-without-currency',
  'currency-not-iso-4217',
  'mixed-currency',
  'negative-value',
  'unknown-column',
  'no-provenance',
  'no-warranty',
  'no-price',
  'battery-pairing-unknown',
] as const;

export type CatalogueIssueCode = (typeof CATALOGUE_ISSUE_CODES)[number];

export const catalogueIssueSchema = z.object({
  code: z.enum(CATALOGUE_ISSUE_CODES),
  severity: z.enum(['error', 'warning']),
  message: z.string().min(1).max(500),
  rowNumber: z.number().int().positive().nullable().default(null),
  column: z.string().max(80).nullable().default(null),
});

export type CatalogueIssue = z.infer<typeof catalogueIssueSchema>;

/**
 * The answer to an upload: what was stored, what was not, and why.
 *
 * The accepted rows come back whole rather than as ids because the installer's
 * next question is "what did you make of my file", and the normalised row --
 * price in minor units, category canonicalised, every absent field null -- is
 * the answer. A report that only counted rows would leave them comparing their
 * spreadsheet against nothing.
 */
export const catalogueUploadResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  products: z.array(productSchema),
  issues: z.array(catalogueIssueSchema),
  /** How many products this tenant now holds, including this upload. */
  catalogueSize: z.number().int().nonnegative(),
  mode: z.enum(['replace', 'append']),
  /** True when nothing was stored: the file was read and reported only. */
  dryRun: z.boolean(),
});

export type CatalogueUploadResponse = z.infer<typeof catalogueUploadResponseSchema>;

/**
 * What an installer sends to load a catalogue.
 *
 * `dryRun` exists because the first thing anyone does with a new importer is
 * check what it would do to their file, and the honest way to support that is in
 * the route rather than by uploading and then apologising.
 *
 * `tenantId` is here, unlike on every visitor-facing route, because this one is
 * authenticated as the *installer* by an admin token rather than as a visitor by
 * a session token. It is named by the caller and checked against the registry;
 * on the widget routes the tenant comes from the token so that a caller cannot
 * name one.
 */
export const catalogueUploadRequestSchema = z
  .object({
    tenantId: z.string().min(1).max(80),
    /** A CSV file, as text. */
    csv: z.string().max(4_000_000).optional(),
    /** Or structured records, read by the same reader as the CSV. */
    records: z.array(z.record(z.unknown())).max(5000).optional(),
    mode: z.enum(['replace', 'append']).default('replace'),
    dryRun: z.boolean().default(false),
  })
  .refine((body) => (body.csv === undefined) !== (body.records === undefined), {
    message: 'Send either csv or records, not both and not neither.',
  });

export type CatalogueUploadRequest = z.infer<typeof catalogueUploadRequestSchema>;

/**
 * The catalogue as the widget-facing route returns it.
 *
 * No `storeId` or internal reference appears here: the row is public to the
 * tenant's own visitors, and the fields it carries are the ones a product card
 * shows.
 */
export const catalogueResponseSchema = z.object({
  products: z.array(productSchema),
  currencies: z.array(z.string()),
  categories: z.array(z.enum(PRODUCT_CATEGORIES)),
});

export type CatalogueResponse = z.infer<typeof catalogueResponseSchema>;

/**
 * What the visitor has asked for, accumulated rather than restated.
 *
 * The model fills this from the conversation -- "cheaper", "with a battery",
 * "under eight thousand", "about four kilowatts" -- and every field is optional
 * because a refinement states what *changed*. The route merges it into the
 * constraints already standing on the session, which is the only way "cheaper"
 * can mean cheaper than the last set without trusting the model to repeat
 * everything the visitor said ten turns ago. `reset` is the exception: it
 * clears the standing constraints, for a visitor who has changed their mind.
 *
 * Nothing here is a product detail. A size or a budget arriving through this
 * schema is the visitor's own words turned into a number, and the response says
 * so; a *price* arriving here would be a figure with no row behind it.
 */
export const recommendationWantSchema = z.object({
  /** The visitor's stated ceiling, in major units (8000 for £8,000). */
  maxBudgetMajor: z.number().positive().max(1_000_000).optional(),
  /** Guarded to the catalogue's own currency by the route before it is used. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  /** System size the visitor asked for, in kilowatts peak. */
  targetKwp: z.number().positive().max(1000).optional(),
  /** Or a panel count, when that is how they said it. */
  panelCount: z.number().int().positive().max(1000).optional(),
  requireBattery: z.boolean().optional(),
  requireEvCharging: z.boolean().optional(),
  /** Minimum battery capacity in kWh, when they named one. */
  minBatteryKwh: z.number().positive().max(1000).optional(),
  /** How many options to return. Defaults to three. */
  limit: z.number().int().min(1).max(5).optional(),
  /** Ascending price rather than the default order. */
  preferCheaper: z.boolean().optional(),
  /** Discard the standing constraints and start from this one alone. */
  reset: z.boolean().optional(),
});

export type RecommendationWant = z.infer<typeof recommendationWantSchema>;

export const recommendationRequestSchema = z.object({
  sessionId: z.string().min(1).max(200),
  want: recommendationWantSchema.optional(),
});

export type RecommendationRequest = z.infer<typeof recommendationRequestSchema>;

/**
 * One line of the audit a recommendation carries.
 *
 * `constraintsChecked` is the part of the plan's output that keeps this honest:
 * a caller can see not only that a product was excluded but which rule did it,
 * and -- for `skipped-missing-data` -- that a rule did *not* run, because the
 * catalogue did not carry what it needed. Silence is not a pass.
 */
export const CONSTRAINT_OUTCOMES = ['applied', 'skipped-missing-data', 'not-applicable'] as const;

export const constraintCheckSchema = z.object({
  id: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
  outcome: z.enum(CONSTRAINT_OUTCOMES),
  /** The numbers the rule used, or what it was missing. */
  detail: z.string().max(500),
});

export type ConstraintCheck = z.infer<typeof constraintCheckSchema>;

export const packageItemSchema = z.object({
  productId: z.string().min(1).max(80),
  category: z.enum(PRODUCT_CATEGORIES),
  manufacturer: z.string(),
  model: z.string(),
  /** How many of this product the option uses. Panels are usually more than one. */
  quantity: z.number().int().positive(),
  powerW: z.number().int().positive().nullable().default(null),
  capacityWh: z.number().int().positive().nullable().default(null),
  priceMinor: z.number().int().nonnegative().nullable().default(null),
  priceStatus: z.enum(PRICE_STATUSES),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .default(null),
  /** Where this product's figure came from, for the installer and the visitor. */
  sourceRef: z.string().nullable().default(null),
  warrantyYears: z.number().int().nonnegative().nullable().default(null),
});

export type PackageItem = z.infer<typeof packageItemSchema>;

/**
 * An option, with the four things §7.4 asks a product card to carry: what it
 * is, why it is here, what it does not settle, and what happens next.
 *
 * `totalMinor` is null unless every item is priced. `totalStatus` is `verified`
 * only when every item's price carries provenance, so a package that mixes one
 * referenced price with four typed ones is labelled indicative rather than
 * being rounded up to a certainty by the presence of one good row.
 */
export const packageOptionSchema = z.object({
  id: z.string().min(1).max(80),
  rank: z.number().int().positive(),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(500),
  items: z.array(packageItemSchema),
  totalMinor: z.number().int().nonnegative().nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  totalStatus: z.enum(PRICE_STATUSES),
  /** Total DC power of the panels, in watts, when every panel row has one. */
  systemPowerW: z.number().int().positive().nullable(),
  batteryCapacityWh: z.number().int().positive().nullable(),
  reasons: z.array(z.string().min(1).max(300)),
  limitations: z.array(z.string().min(1).max(300)),
  nextStep: z.string().min(1).max(300),
});

export type PackageOption = z.infer<typeof packageOptionSchema>;

export const exclusionSchema = z.object({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(500),
  /** The rows this reason is about, empty when it is about the request. */
  productIds: z.array(z.string()).default([]),
});

export type Exclusion = z.infer<typeof exclusionSchema>;

/**
 * The whole answer.
 *
 * `assumptions` and `surveyConfirmed` are the plan's "assumptions versus
 * survey-confirmed data" split made explicit: `assumptions` names every input
 * that came from the conversation rather than from a measurement, and
 * `surveyConfirmed` lists what the visitor's answers have actually settled.
 * A response with an empty `surveyConfirmed` is telling the truth about a
 * conversation that has not produced a survey yet.
 */
export const recommendationResponseSchema = z.object({
  generatedAt: z.string().min(1),
  /** What the catalogue could support at all, before any constraint. */
  catalogue: z.object({
    products: z.number().int().nonnegative(),
    priceable: z.number().int().nonnegative(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
  }),
  /** The constraints in force, merged from this request and the standing set. */
  want: recommendationWantSchema,
  constraintsChecked: z.array(constraintCheckSchema),
  packages: z.array(packageOptionSchema),
  exclusions: z.array(exclusionSchema),
  assumptions: z.array(z.string()),
  surveyConfirmed: z.array(z.string()),
  /** One line the assistant can say verbatim when there is nothing to show. */
  note: z.string().min(1).max(500),
});

export type RecommendationResponse = z.infer<typeof recommendationResponseSchema>;
