import type { ConstraintCheck, Exclusion, Product, RecommendationWant } from '@sunny/contracts';

/**
 * The compatibility rules, and the boundary of what they are allowed to claim.
 *
 * Every rule here has the same shape: it fires only on a *contradiction in the
 * installer's own data*, and reports `skipped-missing-data` when that data is
 * not there. That is not caution for its own sake. A rule that turned a missing
 * attribute into a verdict would be inventing engineering -- "this inverter
 * cannot take a battery" is a claim about hardware, and the only thing that can
 * support it is the catalogue saying so. A rule that shrugs at a contradiction
 * is worse: it shows a visitor a combination the installer's own spreadsheet
 * says does not work.
 *
 * Two rules that used to live inline in `validate_compatibility` are gone, and
 * their absence is deliberate. "More than 20 panels is more than a small roof
 * will take" and "a north-facing roof will generate materially less than the
 * model assumes" are neither of them in any source this build can cite: the
 * questionnaire bands a roof as small, medium or large and names no panel count,
 * and nothing here has a yield model to be materially less than. Both are
 * replaced by a survey limitation, which is what the plan asks for -- structural
 * suitability is not to be presented as fact, and a number nobody can source is
 * the clearest way to present it as one. D-27.
 */

export interface RuleContext {
  products: readonly Product[];
  answers: Record<string, string>;
  want: RecommendationWant;
}

/** How much a pairing can be trusted, which is all the catalogue can tell us. */
export type PairingVerdict = 'compatible' | 'incompatible' | 'unknown';

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether a catalogue's free-text entry names this device.
 *
 * A price list writes a compatible inverter as "Voltix VX-4K" about as often as
 * it writes "VX-4K", and both mean the same product. Comparing against the model
 * alone would read the first form as naming *some other* inverter -- and since a
 * named list that does not contain the device is an explicit `incompatible`, the
 * formatting alone would produce a contradiction the installer never stated.
 * Matching cannot accidentally pair two unrelated devices: the longer form still
 * has to carry this manufacturer's own name.
 */
function namesProduct(entry: string, product: Product): boolean {
  return (
    sameName(entry, product.model) || sameName(entry, `${product.manufacturer} ${product.model}`)
  );
}

/**
 * Whether a battery and an inverter can be shown to work together.
 *
 * `incompatible` needs the installer's own list to name the other device and
 * not contain it -- two named lists, each of which can exclude. `unknown` is
 * everything else, including the case that looks tempting: `hybrid: true` says
 * an inverter can charge a battery, not which batteries, so it earns no verdict
 * on its own. Treating it as one would put a battery on a card on the strength
 * of a boolean.
 */
export function batteryInverterPairing(battery: Product, inverter: Product): PairingVerdict {
  const models = battery.compatibility.inverterModels;
  const families = inverter.compatibility.batteryFamilies;

  if (
    models !== null &&
    models.length > 0 &&
    models.some((model) => namesProduct(model, inverter))
  ) {
    return 'compatible';
  }
  const family = battery.compatibility.batteryFamily;
  if (family !== null && families !== null && families.length > 0) {
    return families.some((entry) => sameName(entry, family)) ? 'compatible' : 'incompatible';
  }
  if (
    models !== null &&
    models.length > 0 &&
    !models.some((model) => namesProduct(model, inverter))
  ) {
    // The battery names the inverters it works with and this is not one of them.
    return 'incompatible';
  }
  return 'unknown';
}

function check(
  id: string,
  description: string,
  outcome: ConstraintCheck['outcome'],
  detail: string,
): ConstraintCheck {
  return { id, description, outcome, detail };
}

function exclusion(code: string, message: string, productIds: string[] = []): Exclusion {
  return { code, message, productIds };
}

/**
 * The checks that depend on the catalogue as a whole rather than on one option.
 *
 * Returned separately from the per-option rules because they are the ones a
 * visitor's answers cannot change: whether there is a catalogue at all, and
 * whether it prices its products in one currency.
 */
export function catalogueChecks(context: RuleContext): {
  checks: ConstraintCheck[];
  exclusions: Exclusion[];
  currency: string | null;
} {
  const checks: ConstraintCheck[] = [];
  const exclusions: Exclusion[] = [];

  const priceable = context.products.filter((product) => product.priceMinor !== null);
  if (context.products.length === 0) {
    checks.push(
      check(
        'catalogue-present',
        'Products are available to recommend from.',
        'not-applicable',
        'The installer has no products in the catalogue.',
      ),
    );
    return { checks, exclusions, currency: null };
  }
  checks.push(
    check(
      'catalogue-present',
      'Products are available to recommend from.',
      'applied',
      `${context.products.length} products, ${priceable.length} of them priced.`,
    ),
  );

  const currencies = [
    ...new Set(
      priceable
        .map((product) => product.currency)
        .filter((value): value is string => value !== null),
    ),
  ];
  if (currencies.length > 1) {
    // Upload refuses a mixed file, so this is only reachable if a tenant holds
    // two imports that each looked single-currency. Saying so beats averaging.
    exclusions.push(
      exclusion(
        'mixed-currency',
        `The catalogue prices products in ${currencies.join(' and ')}. Sunny does not convert between currencies, so no total can be given.`,
      ),
    );
    checks.push(
      check('single-currency', 'Every price is in one currency.', 'applied', currencies.join(', ')),
    );
    return { checks, exclusions, currency: null };
  }

  checks.push(
    check(
      'single-currency',
      'Every price is in one currency.',
      currencies.length === 0 ? 'not-applicable' : 'applied',
      currencies.length === 0 ? 'No product in the catalogue carries a price.' : currencies[0]!,
    ),
  );
  return { checks, exclusions, currency: currencies[0] ?? null };
}

/**
 * What the visitor has told us about the roof, and what it does *not* settle.
 *
 * Every answer here is the visitor's own estimate, so none of them earns a
 * number in a response. What they earn is a limitation on the option and a line
 * in `surveyConfirmed` if the answer is settled enough to count -- which is the
 * plan's assumptions-versus-survey split, applied to the only inputs that
 * describe the building rather than the equipment.
 */
export function roofFindings(answers: Record<string, string>): {
  checks: ConstraintCheck[];
  limitations: string[];
  surveyConfirmed: string[];
  assumptions: string[];
} {
  const limitations: string[] = [];
  const surveyConfirmed: string[] = [];
  const assumptions: string[] = [];

  const size = answers['roof_size'];
  const direction = answers['roof_direction'];
  const shading = answers['roof_shading'];
  const confidence = answers['roof_confidence'];

  if (size === 'unsure' || direction === 'unsure' || shading === 'unsure' || confidence === 'low') {
    limitations.push(
      'Roof size, orientation or shading is the visitor’s own estimate, not a survey.',
    );
    assumptions.push('Roof details come from the visitor, not from a survey or an assessment.');
  } else if (size !== undefined && direction !== undefined) {
    surveyConfirmed.push(`Roof faces ${direction.replace(/_/g, ' ')}, sized ${size}, as reported.`);
  }

  if (direction === 'north') {
    limitations.push('A north-facing roof generation figure needs a survey before it is quoted.');
  }
  if (shading === 'heavy') {
    limitations.push(
      'Heavy shading needs an on-site survey before any generation figure is quoted.',
    );
  } else if (shading === 'trees' || shading === 'buildings') {
    limitations.push('Shading from trees or buildings is described, not measured.');
  }

  const applied = limitations.length > 0 || surveyConfirmed.length > 0;
  return {
    checks: [
      check(
        'roof-survey',
        'Roof facts are reported rather than measured.',
        applied ? 'applied' : 'not-applicable',
        limitations.length > 0
          ? 'Any generation figure for this roof is unverified until a survey.'
          : 'No roof answer needs a caveat.',
      ),
    ],
    limitations,
    surveyConfirmed,
    assumptions,
  };
}

/**
 * Whether a system the visitor described hangs together, for the
 * `validate_compatibility` tool.
 *
 * It is the same arithmetic the recommendation engine applies to assembled
 * options, exposed for a visitor who has named a size rather than asked for
 * options -- "I want twelve panels" should get an answer about twelve panels,
 * not a catalogue search.
 */
export function validateSystem(
  context: RuleContext,
  proposal: {
    panelProductId?: string | null;
    panelCount?: number | null;
    inverterProductId?: string | null;
    batteryProductId?: string | null;
  },
): { checks: ConstraintCheck[]; warnings: string[]; notes: string[]; exclusions: Exclusion[] } {
  const checks: ConstraintCheck[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const exclusions: Exclusion[] = [];

  const inverter =
    context.products.find((product) => product.id === proposal.inverterProductId) ?? null;
  const panel =
    context.products.find((product) => product.id === proposal.panelProductId) ??
    context.products.find((product) => product.category === 'panel' && product.powerW !== null) ??
    null;
  const battery =
    context.products.find((product) => product.id === proposal.batteryProductId) ?? null;
  const count = proposal.panelCount ?? null;

  if (panel && count && count > 0) {
    if (panel.powerW === null) {
      checks.push(
        check(
          'panel-power-known',
          'The panel’s wattage is known.',
          'skipped-missing-data',
          `${panel.manufacturer} ${panel.model} has no wattage in the catalogue.`,
        ),
      );
      notes.push(`The catalogue has no wattage for ${panel.manufacturer} ${panel.model}.`);
    } else if (inverter) {
      const totalPanelW = panel.powerW * count;
      const limit = inverter.compatibility.maxDcPowerW;
      if (limit === null) {
        checks.push(
          check(
            'inverter-dc-limit',
            'Total panel power is within the inverter’s DC input limit.',
            'skipped-missing-data',
            `${inverter.manufacturer} ${inverter.model} has no maximum DC input power in the catalogue.`,
          ),
        );
      } else if (totalPanelW > limit) {
        const message = `${count} × ${panel.manufacturer} ${panel.model} is ${totalPanelW} W, above the ${limit} W DC input limit of ${inverter.manufacturer} ${inverter.model}.`;
        warnings.push(`${message} Choose fewer panels or a larger inverter.`);
        exclusions.push(exclusion('inverter-dc-limit', message, [panel.id, inverter.id]));
        checks.push(
          check(
            'inverter-dc-limit',
            'Total panel power is within the inverter’s DC input limit.',
            'applied',
            `${totalPanelW} W against ${limit} W.`,
          ),
        );
      } else {
        checks.push(
          check(
            'inverter-dc-limit',
            'Total panel power is within the inverter’s DC input limit.',
            'applied',
            `${totalPanelW} W against ${limit} W.`,
          ),
        );
      }
    }

    if (panel.compatibility.vocV !== null && inverter) {
      const limit = inverter.compatibility.maxStringVoltageV;
      if (limit === null) {
        checks.push(
          check(
            'panel-string-voltage',
            'A panel fits within the inverter’s maximum string voltage.',
            'skipped-missing-data',
            `${inverter.manufacturer} ${inverter.model} has no maximum string voltage in the catalogue.`,
          ),
        );
      } else if (panel.compatibility.vocV > limit) {
        const message = `One ${panel.manufacturer} ${panel.model} has an open-circuit voltage of ${panel.compatibility.vocV} V, above the ${limit} V string limit of ${inverter.manufacturer} ${inverter.model}.`;
        warnings.push(message);
        exclusions.push(exclusion('panel-string-voltage', message, [panel.id, inverter.id]));
        checks.push(
          check(
            'panel-string-voltage',
            'A panel fits within the inverter’s maximum string voltage.',
            'applied',
            `${panel.compatibility.vocV} V against ${limit} V.`,
          ),
        );
      } else {
        checks.push(
          check(
            'panel-string-voltage',
            'A panel fits within the inverter’s maximum string voltage.',
            'applied',
            `${panel.compatibility.vocV} V against ${limit} V.`,
          ),
        );
      }
    }
  }

  if (battery && inverter) {
    const verdict = batteryInverterPairing(battery, inverter);
    if (verdict === 'incompatible') {
      const message = `${battery.manufacturer} ${battery.model} is not listed as working with ${inverter.manufacturer} ${inverter.model}.`;
      warnings.push(message);
      exclusions.push(exclusion('battery-inverter-pairing', message, [battery.id, inverter.id]));
      checks.push(
        check(
          'battery-inverter-pairing',
          'The battery and the inverter are a listed pair.',
          'applied',
          message,
        ),
      );
    } else if (verdict === 'unknown') {
      notes.push(
        `The catalogue does not say whether ${battery.manufacturer} ${battery.model} works with ${inverter.manufacturer} ${inverter.model}; the installer will need to confirm.`,
      );
      checks.push(
        check(
          'battery-inverter-pairing',
          'The battery and the inverter are a listed pair.',
          'skipped-missing-data',
          'Neither the battery nor the inverter lists the other.',
        ),
      );
    } else {
      checks.push(
        check(
          'battery-inverter-pairing',
          'The battery and the inverter are a listed pair.',
          'applied',
          'Listed by the catalogue.',
        ),
      );
    }
  }

  const roof = roofFindings(context.answers);
  checks.push(...roof.checks);
  notes.push(...roof.limitations);

  return { checks, warnings, notes, exclusions };
}
