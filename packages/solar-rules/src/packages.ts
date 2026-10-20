import type {
  ConstraintCheck,
  Exclusion,
  PackageItem,
  PackageOption,
  PriceStatus,
  Product,
  RecommendationResponse,
  RecommendationWant,
} from '@sunny/contracts';

import { batteryInverterPairing, catalogueChecks, roofFindings } from './constraints.js';

/**
 * Turning a catalogue into options a visitor can read.
 *
 * The shape of this file follows from one decision: **the engine never invents
 * an input**. It sizes a system only from a figure the visitor gave, prices an
 * option only from rows the installer uploaded, and writes a total only when
 * every line in it has a price. Everything it could have guessed -- a default
 * system size, a typical price, a "panel count that fits a roof this size" --
 * is a number that would reach a visitor with nothing behind it, which is the
 * one thing a recommendation from this product must never be.
 *
 * What is left is arithmetic over the installer's own rows, and the arithmetic
 * is where the compatibility rules earn their keep: an option reaching the
 * visitor has already been through the DC input limit, the string voltage and
 * the battery pairing, and the reasons on the card are the checks that passed
 * rather than marketing copy.
 *
 * The other decision is that a request *accumulates*. "Cheaper" arrives as one
 * field on a want, and it means cheaper than the last set only because the
 * standing constraints are merged in before anything is assembled: the model is
 * never asked to repeat what the visitor said eight turns ago, and a refinement
 * can therefore never silently drop a requirement it did not mention. `reset`
 * is the deliberate door out.
 */

export interface RecommendInput {
  products: readonly Product[];
  answers: Record<string, string>;
  want: RecommendationWant;
  /** Injected so the response is reproducible in a test. */
  now: string;
}

/**
 * Fold a refinement into what the visitor has already asked for.
 *
 * A field the refinement leaves out is a field that stands; a field it sets,
 * including a `false`, replaces what was there. `reset` is consumed here rather
 * than stored -- it is an instruction about the merge, not a standing constraint.
 */
export function mergeWant(
  standing: RecommendationWant,
  incoming: RecommendationWant,
): RecommendationWant {
  const { reset, ...refinement } = incoming;
  if (reset === true) return { ...refinement };

  const merged: RecommendationWant = { ...standing };
  for (const [key, value] of Object.entries(refinement) as [keyof RecommendationWant, unknown][]) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

function byName(a: Product, b: Product): number {
  return (
    a.manufacturer.localeCompare(b.manufacturer) ||
    a.model.localeCompare(b.model) ||
    a.id.localeCompare(b.id)
  );
}

/** Deterministic order, so two runs over the same catalogue agree exactly. */
function pool(products: readonly Product[], category: Product['category']): Product[] {
  return products.filter((product) => product.category === category).sort(byName);
}

function totalStatusFor(items: readonly PackageItem[]): PriceStatus {
  if (items.some((item) => item.priceMinor === null)) return 'unknown';
  return items.every((item) => item.priceStatus === 'verified') ? 'verified' : 'indicative';
}

function toItem(product: Product, quantity: number): PackageItem {
  return {
    productId: product.id,
    category: product.category,
    manufacturer: product.manufacturer,
    model: product.model,
    quantity,
    powerW: product.powerW,
    capacityWh: product.capacityWh,
    priceMinor: product.priceMinor,
    priceStatus: product.priceStatus,
    currency: product.currency,
    sourceRef: product.sourceRef,
    warrantyYears: product.warrantyYears,
  };
}

function kW(watts: number): string {
  return `${(watts / 1000).toFixed(1)} kW`;
}

/**
 * How many panels the visitor's own figure means.
 *
 * Rounded rather than floored or ceiled: "about four kilowatts" of a 430 W panel
 * is 9.3 panels, and the nearest whole panel is the reading a person makes. A
 * count the visitor named is taken as given -- it is their number, and the DC
 * limit check is where it gets tested.
 */
function panelCountFor(want: RecommendationWant, panel: Product): number | null {
  if (want.panelCount !== undefined) return want.panelCount;
  if (want.targetKwp !== undefined && panel.powerW !== null) {
    return Math.max(1, Math.round((want.targetKwp * 1000) / panel.powerW));
  }
  return null;
}

/** The cheapest priced battery that the inverter can be shown to work with. */
function chooseBattery(
  batteries: readonly Product[],
  inverter: Product,
  want: RecommendationWant,
): Product | null {
  const minWh = want.minBatteryKwh !== undefined ? want.minBatteryKwh * 1000 : null;
  const eligible = batteries.filter((battery) => {
    if (minWh !== null) {
      if (battery.capacityWh === null || battery.capacityWh < minWh) return false;
    }
    return batteryInverterPairing(battery, inverter) !== 'incompatible';
  });
  if (eligible.length === 0) return null;

  // A listed pair beats an unlisted one at any price: a cheaper battery whose
  // compatibility nobody recorded is not the better answer, it is the less
  // certain one, and the plan's finding is that uncertainty belongs on the card.
  const ranked = [...eligible].sort((a, b) => {
    const verdictRank = (product: Product): number =>
      batteryInverterPairing(product, inverter) === 'compatible' ? 0 : 1;
    return verdictRank(a) - verdictRank(b) || priceRank(a) - priceRank(b) || byName(a, b);
  });
  return ranked[0] ?? null;
}

function priceRank(product: Product): number {
  return product.priceMinor ?? Number.MAX_SAFE_INTEGER;
}

interface OptionBuild {
  option: PackageOption;
  checks: ConstraintCheck[];
  /** Set when the option is priced, in minor units, so ranking needs no re-sum. */
  sortPrice: number;
}

function check(
  id: string,
  description: string,
  outcome: ConstraintCheck['outcome'],
  detail: string,
): ConstraintCheck {
  return { id, description, outcome, detail };
}

function buildOption(input: {
  inverter: Product;
  panel: Product;
  count: number;
  battery: Product | null;
  ev: Product | null;
  roofLimitations: readonly string[];
  want: RecommendationWant;
}): OptionBuild | { excluded: Exclusion } {
  const { inverter, panel, count, battery, ev, roofLimitations } = input;
  const checks: ConstraintCheck[] = [];
  const reasons: string[] = [];
  const limitations: string[] = [...roofLimitations];

  const totalPanelW = panel.powerW !== null ? panel.powerW * count : null;

  // The three rules that can reject an option outright, run in the same order
  // every time so the same catalogue and request always produce the same list.
  const dcLimit = inverter.compatibility.maxDcPowerW;
  if (totalPanelW !== null && dcLimit !== null) {
    if (totalPanelW > dcLimit) {
      return {
        excluded: {
          code: 'inverter-dc-limit',
          message: `${count} × ${panel.manufacturer} ${panel.model} is ${totalPanelW} W, above the ${dcLimit} W DC input limit of ${inverter.manufacturer} ${inverter.model}.`,
          productIds: [panel.id, inverter.id],
        },
      };
    }
    reasons.push(
      `The ${totalPanelW} W of panels is within the inverter's ${dcLimit} W DC input limit.`,
    );
    checks.push(
      check(
        'inverter-dc-limit',
        "Total panel power is within the inverter's DC input limit.",
        'applied',
        `${totalPanelW} W against ${dcLimit} W.`,
      ),
    );
  } else {
    checks.push(
      check(
        'inverter-dc-limit',
        "Panel power is within the inverter's DC input limit.",
        'skipped-missing-data',
        totalPanelW === null
          ? `${panel.manufacturer} ${panel.model} has no wattage in the catalogue.`
          : `${inverter.manufacturer} ${inverter.model} has no maximum DC input power in the catalogue.`,
      ),
    );
    limitations.push(
      'The catalogue does not carry the figures needed to check the inverter’s DC input limit.',
    );
  }

  const maxStringV = inverter.compatibility.maxStringVoltageV;
  const vocV = panel.compatibility.vocV;
  if (vocV !== null && maxStringV !== null) {
    if (vocV > maxStringV) {
      return {
        excluded: {
          code: 'panel-string-voltage',
          message: `One ${panel.manufacturer} ${panel.model} has an open-circuit voltage of ${vocV} V, above the ${maxStringV} V string limit of ${inverter.manufacturer} ${inverter.model}.`,
          productIds: [panel.id, inverter.id],
        },
      };
    }
    reasons.push(
      `Each panel's ${vocV} V open-circuit voltage is within the inverter's ${maxStringV} V string limit.`,
    );
    checks.push(
      check(
        'panel-string-voltage',
        "A panel fits within the inverter's maximum string voltage.",
        'applied',
        `${vocV} V against ${maxStringV} V.`,
      ),
    );
  }

  const items: PackageItem[] = [toItem(panel, count), toItem(inverter, 1)];

  if (battery) {
    const verdict = batteryInverterPairing(battery, inverter);
    items.push(toItem(battery, 1));
    if (verdict === 'compatible') {
      reasons.push(
        `${battery.manufacturer} ${battery.model} is listed as working with this inverter.`,
      );
      checks.push(
        check(
          'battery-inverter-pairing',
          'The battery and the inverter are a listed pair.',
          'applied',
          'Listed by the catalogue.',
        ),
      );
    } else {
      // It got this far because nothing contradicted it. That is not the same as
      // a confirmation, and the card says which one it has.
      limitations.push(
        'The catalogue does not confirm this battery works with the inverter; the installer will need to.',
      );
      checks.push(
        check(
          'battery-inverter-pairing',
          'The battery and the inverter are a listed pair.',
          'skipped-missing-data',
          'Neither row names the other.',
        ),
      );
    }
  }
  if (ev) {
    items.push(toItem(ev, 1));
    reasons.push(`${ev.manufacturer} ${ev.model} is included for EV charging.`);
  }

  // A total needs every line priced *and* every line priced in the same money.
  // Two currencies and no row missing is still not a total, and adding them
  // would be the one arithmetic mistake here that produces a plausible number.
  const currency = items.every(
    (item) => item.currency !== null && item.currency === items[0]!.currency,
  )
    ? items[0]!.currency
    : null;
  const totalMinor =
    currency === null || items.some((item) => item.priceMinor === null)
      ? null
      : items.reduce((sum, item) => sum + item.priceMinor! * item.quantity, 0);
  const totalStatus = totalStatusFor(items);

  if (items.some((item) => item.priceMinor === null)) {
    limitations.push(
      'At least one item has no price in the catalogue, so this option has no total.',
    );
  } else if (currency === null) {
    limitations.push(
      'These items are priced in different currencies, so this option has no total.',
    );
  } else if (totalStatus === 'indicative') {
    limitations.push('Some prices have no source recorded, so they are indicative.');
  }

  const batteryCapacityWh = battery?.capacityWh ?? null;

  const headline = totalPanelW !== null ? kW(totalPanelW) : `${count} panels`;
  const parts = [
    `${headline}`,
    `${count} × ${panel.manufacturer} ${panel.model}`,
    `${inverter.manufacturer} ${inverter.model}`,
  ];
  if (battery)
    parts.push(
      batteryCapacityWh !== null
        ? `${(batteryCapacityWh / 1000).toFixed(1)} kWh ${battery.manufacturer} battery`
        : `${battery.manufacturer} battery`,
    );
  if (ev) parts.push(`${ev.manufacturer} ${ev.model} EV charger`);

  const option: PackageOption = {
    id: `opt-${inverter.id}-${panel.id}-${count}${battery ? `-${battery.id}` : ''}${ev ? `-${ev.id}` : ''}`.slice(
      0,
      80,
    ),
    rank: 0,
    title: parts.join(' · ').slice(0, 200),
    summary: `A ${headline} system: ${count} × ${panel.manufacturer} ${panel.model} with a ${inverter.manufacturer} ${inverter.model}${battery ? ` and ${battery.manufacturer} ${battery.model} battery storage` : ''}.`,
    items,
    totalMinor,
    currency: totalMinor === null ? null : currency,
    totalStatus,
    systemPowerW: totalPanelW,
    batteryCapacityWh,
    reasons,
    limitations,
    nextStep: 'Book a survey so the installer can confirm this combination and give a firm price.',
  };

  return { option, checks, sortPrice: totalMinor ?? Number.MAX_SAFE_INTEGER };
}

/**
 * Order the options, best first.
 *
 * Three keys, and the first one is the one that matters: an option whose prices
 * carry a source beats one whose prices were typed, because the second is a
 * number the installer will not stand behind. A cheaper price never outranks a
 * better-provenanced one unless the visitor asked for cheapest, and then only
 * within what survives the budget and the compatibility rules.
 */
function rankOptions(builds: readonly OptionBuild[], want: RecommendationWant): OptionBuild[] {
  const key = (build: OptionBuild): (number | string)[] => {
    const { option } = build;
    const provenance =
      option.totalStatus === 'verified' ? 0 : option.totalStatus === 'indicative' ? 1 : 2;
    const priced = option.totalMinor === null ? 1 : 0;
    if (want.preferCheaper === true) {
      // Cheapest the visitor can actually pay for, cheapest first; unpriced last,
      // because a price nobody can check is not a price to compare against.
      return [priced, build.sortPrice, provenance, option.limitations.length, option.title];
    }
    return [provenance, priced, option.limitations.length, build.sortPrice, option.title];
  };

  return [...builds].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    for (let i = 0; i < left.length; i += 1) {
      const l = left[i]!;
      const r = right[i]!;
      if (l === r) continue;
      if (typeof l === 'string' && typeof r === 'string') return l.localeCompare(r);
      return (l as number) - (r as number);
    }
    return a.option.id.localeCompare(b.option.id);
  });
}

/**
 * How many rows of each kind the engine will look at.
 *
 * A catalogue is meant to be a price list, not a distributor's whole inventory,
 * but nothing stops an installer uploading one. The search below is a nested
 * loop over panels and inverters, so it needs a bound; the bound is on the
 * *cheapest* rows of each kind, which is the end of the list a recommendation
 * is drawn from. When it bites, the response says so rather than quietly
 * considering 24 of 900 panels.
 */
const SEARCH_LIMIT = 24;

function shortlist(products: readonly Product[]): Product[] {
  return [...products]
    .sort((a, b) => {
      const priced = (product: Product): number => (product.priceMinor === null ? 1 : 0);
      return priced(a) - priced(b) || priceRank(a) - priceRank(b) || byName(a, b);
    })
    .slice(0, SEARCH_LIMIT);
}

function exclusionKey(exclusion: Exclusion): string {
  return `${exclusion.code}:${exclusion.message}`;
}

export function recommend(input: RecommendInput): RecommendationResponse {
  const { products, answers, want } = input;
  const checks: ConstraintCheck[] = [];
  const exclusions: Exclusion[] = [];

  const catalogue = catalogueChecks({ products, answers, want });
  checks.push(...catalogue.checks);
  exclusions.push(...catalogue.exclusions);

  const roof = roofFindings(answers);
  checks.push(...roof.checks);

  const assumptions: string[] = [
    ...roof.assumptions,
    'Every option is assembled from the installer’s own catalogue rows; no price comes from anywhere else.',
  ];
  const surveyConfirmed = [...roof.surveyConfirmed];

  const panels = pool(products, 'panel');
  const inverters = pool(products, 'inverter');
  const batteries = pool(products, 'battery');
  const evs = pool(products, 'ev_charger');
  const priceable = products.filter((product) => product.priceMinor !== null).length;

  if (panels.length > SEARCH_LIMIT || inverters.length > SEARCH_LIMIT) {
    checks.push(
      check(
        'catalogue-search-bounded',
        'The whole catalogue was considered.',
        'applied',
        `Only the ${SEARCH_LIMIT} cheapest panels and inverters were compared; the catalogue holds ${panels.length} panels and ${inverters.length} inverters.`,
      ),
    );
  }

  // --- The budget, and the one thing that can stop it being usable ----------

  let budgetMinor: number | null = null;
  if (want.maxBudgetMajor === undefined) {
    checks.push(
      check(
        'budget',
        'Options are within the visitor’s budget.',
        'not-applicable',
        'No budget was given.',
      ),
    );
  } else if (catalogue.currency === null && products.length > 0) {
    checks.push(
      check(
        'budget',
        'Options are within the visitor’s budget.',
        'skipped-missing-data',
        'No priced row exists to compare a budget against.',
      ),
    );
  } else if (
    want.currency !== undefined &&
    catalogue.currency !== null &&
    want.currency !== catalogue.currency
  ) {
    // Refusing here rather than converting is the whole policy in one branch:
    // an FX rate would be a number nobody supplied, attached to a price someone did.
    checks.push(
      check(
        'budget',
        'Options are within the visitor’s budget.',
        'skipped-missing-data',
        `The request names ${want.currency} and the catalogue prices in ${catalogue.currency}; Sunny does not convert between currencies, so no budget was applied.`,
      ),
    );
  } else {
    budgetMinor = Math.round(want.maxBudgetMajor * 100);
    checks.push(
      check(
        'budget',
        'Options are within the visitor’s budget.',
        'applied',
        `A ceiling of ${catalogue.currency ?? ''} ${(budgetMinor / 100).toFixed(2)}.`.trim(),
      ),
    );
  }

  // --- The size the visitor asked for ---------------------------------------

  const hasSize = want.panelCount !== undefined || want.targetKwp !== undefined;
  checks.push(
    hasSize
      ? check(
          'system-size',
          'A system size was given to build from.',
          'applied',
          want.panelCount !== undefined
            ? `${want.panelCount} panels, as the visitor said.`
            : `${want.targetKwp} kWp, as the visitor said.`,
        )
      : check(
          'system-size',
          'A system size was given to build from.',
          'not-applicable',
          'The visitor has not said how big a system they are considering.',
        ),
  );
  if (want.targetKwp !== undefined || want.panelCount !== undefined) {
    assumptions.push(
      'The system size is the visitor’s own figure, not a survey or a yield calculation.',
    );
  }

  const requireBattery = want.requireBattery === true || want.minBatteryKwh !== undefined;
  if (requireBattery && batteries.length === 0) {
    exclusions.push({
      code: 'no-battery-available',
      message: 'The visitor asked for battery storage and the catalogue holds no battery.',
      productIds: [],
    });
  }
  if (want.requireEvCharging === true && evs.length === 0) {
    exclusions.push({
      code: 'no-ev-charger-available',
      message: 'The visitor asked for EV charging and the catalogue holds no EV charger.',
      productIds: [],
    });
  }

  // --- Assembly -------------------------------------------------------------

  const builds: OptionBuild[] = [];
  const overBudget: Exclusion[] = [];
  let unpricedExcluded = false;
  let batteryBlocked = false;

  const blocked =
    products.length === 0 ||
    !hasSize ||
    panels.length === 0 ||
    inverters.length === 0 ||
    (requireBattery && batteries.length === 0);

  if (!blocked) {
    const seen = new Set<string>();
    for (const inverter of shortlist(inverters)) {
      for (const panel of shortlist(panels)) {
        const count = panelCountFor(want, panel);
        if (count === null) continue;

        const battery = requireBattery ? chooseBattery(batteries, inverter, want) : null;
        if (requireBattery && battery === null) {
          // Either nothing meets the capacity asked for, or every battery in the
          // catalogue is one this inverter is *not* listed with. Both are worth
          // saying, and neither is a reason to show a solar-only system to
          // someone who asked for storage.
          batteryBlocked = true;
          continue;
        }
        const ev = want.requireEvCharging === true ? (evs[0] ?? null) : null;

        const built = buildOption({
          inverter,
          panel,
          count,
          battery,
          ev,
          roofLimitations: roof.limitations,
          want,
        });
        if ('excluded' in built) {
          exclusions.push(built.excluded);
          continue;
        }
        if (seen.has(built.option.id)) continue;
        seen.add(built.option.id);

        if (budgetMinor !== null) {
          if (built.option.totalMinor === null) {
            // An option nobody can price cannot be shown to fit a budget, and
            // guessing that it does is exactly the inference this build refuses.
            unpricedExcluded = true;
            continue;
          }
          if (built.option.totalMinor > budgetMinor) {
            if (overBudget.length < 5) {
              overBudget.push({
                code: 'over-budget',
                message:
                  `${built.option.title} totals ${built.option.currency ?? ''} ${(built.option.totalMinor / 100).toFixed(2)}, above the ${(budgetMinor / 100).toFixed(2)} ceiling.`.trim(),
                productIds: built.option.items.map((item) => item.productId),
              });
            }
            continue;
          }
        }

        builds.push(built);
      }
    }
  }

  exclusions.push(...overBudget);
  if (batteryBlocked && batteries.length > 0) {
    exclusions.push({
      code: 'battery-inverter-pairing',
      message:
        want.minBatteryKwh !== undefined
          ? `No battery in the catalogue is listed as working with these inverters at ${want.minBatteryKwh} kWh or more.`
          : 'No battery in the catalogue is listed as working with the inverters that fit these panels.',
      productIds: [],
    });
    checks.push(
      check(
        'battery-inverter-pairing',
        'The battery the visitor asked for pairs with an inverter.',
        'applied',
        'Every candidate pair was contradicted by the catalogue’s own compatibility columns.',
      ),
    );
  }
  if (unpricedExcluded) {
    exclusions.push({
      code: 'price-unknown',
      message:
        'Some options have no price for every item, so they cannot be compared against the budget.',
      productIds: [],
    });
  }

  // What each rule did, named once rather than once per option it looked at. A
  // rule that *passed* is here as `applied` with the numbers it used, and one
  // that could not run is here as `skipped-missing-data` -- which is the half
  // that matters: a pairing nobody recorded shows up as a rule that did not run
  // rather than as an option that merely looks fine. Silence is not a pass, and
  // the reasons printed on a card are the same checks in prose.
  const seenChecks = new Set(checks.map((entry) => `${entry.id}:${entry.detail}`));
  for (const build of builds) {
    for (const entry of build.checks) {
      const key = `${entry.id}:${entry.detail}`;
      if (seenChecks.has(key)) continue;
      seenChecks.add(key);
      checks.push(entry);
    }
  }

  const limit = want.limit ?? 3;
  const packages = rankOptions(builds, want)
    .slice(0, limit)
    .map((build, index) => ({ ...build.option, rank: index + 1 }));

  // --- What to say about all of it ------------------------------------------

  let note: string;
  if (products.length === 0) {
    note =
      'The installer has not loaded a product list yet, so there is nothing to price options from.';
  } else if (panels.length === 0 || inverters.length === 0) {
    note = `The installer’s catalogue has no ${panels.length === 0 ? 'panels' : 'inverters'}, so no system can be priced from it.`;
  } else if (!hasSize) {
    note =
      'Tell Sunny roughly how big a system you are considering (about 4 kW, or a number of panels), and options can be priced from the catalogue.';
  } else if (requireBattery && batteries.length === 0) {
    note = 'No battery is in the installer’s catalogue, so no option with storage can be priced.';
  } else if (batteryBlocked && packages.length === 0) {
    // Worse than an empty catalogue and worth saying differently: there *are*
    // batteries, and the installer's own pairing columns rule every one of them
    // out for the inverters that fit. "No combination meets your requirements"
    // would leave them looking for a size that does not exist.
    note = `No battery in the catalogue is listed as working with an inverter that suits this system${want.minBatteryKwh !== undefined ? ` at ${want.minBatteryKwh} kWh or more` : ''}, so nothing can be offered with storage yet.`;
  } else if (packages.length === 0) {
    note =
      overBudget.length > 0
        ? 'Nothing in the catalogue comes in under the budget you gave. Raising it, or asking for fewer panels, may open up options.'
        : 'No combination in the catalogue meets what you have asked for. The reasons are listed below.';
  } else {
    note = `Here ${packages.length === 1 ? 'is 1 option' : `are ${packages.length} options`} assembled from the installer’s own catalogue and prices.`;
  }

  // Dedupe, because the same reason reaches the list once per option it stopped.
  const uniqueExclusions: Exclusion[] = [];
  const seenExclusions = new Set<string>();
  for (const exclusion of exclusions) {
    const key = exclusionKey(exclusion);
    if (seenExclusions.has(key)) continue;
    seenExclusions.add(key);
    uniqueExclusions.push(exclusion);
  }

  return {
    generatedAt: input.now,
    catalogue: { products: products.length, priceable, currency: catalogue.currency },
    want,
    constraintsChecked: checks,
    packages,
    exclusions: uniqueExclusions,
    assumptions,
    surveyConfirmed,
    note,
  };
}
