/**
 * Why Sunny asks each of its own questions, in a sentence or two the visitor
 * can open from the ⓘ beside the question. A question asked without its reason
 * can feel like prying (ownership, the address); with it, it reads as help.
 *
 * Used sparingly: a reason is given only where the question could feel
 * personal (ownership, the address, the budget, a bill) or where its effect on
 * the quote isn't obvious (radiators, a hot water tank, today's heating).
 * Questions whose purpose is plain from the question itself (household size,
 * property type, the home's age) have none, so the ⓘ stays meaningful.
 *
 * Keyed by preset id, with a version per quote where the reason differs. A
 * question absent here (an installer's own, or one without a useful reason)
 * shows no ⓘ.
 */

export type WhyEngine = 'solar' | 'heat_pump' | 'battery';

type Why = string | Partial<Record<WhyEngine | 'default', string>>;

const WHY: Readonly<Record<string, Why>> = {
  ownership: {
    default:
      "Fitting panels or a battery needs the owner's agreement, so if you rent, your landlord would need to say yes first.",
    heat_pump:
      "The Boiler Upgrade Scheme grant is paid to the property's owner. If you rent, your landlord would apply for it and agree to the work.",
  },
  address: {
    default:
      'It lets me look at your roof from above, so I can work out how many panels fit and how much sun they get, rather than asking you.',
    heat_pump:
      "It lets me find your home's energy certificate, which shows its age, insulation and heating, so I don't have to ask you about them.",
  },
  usage_source:
    'Most of the saving comes from the solar power you use yourself, so your usage sets the right size of system. A recent bill is the most accurate.',
  hp_current_heating:
    'I compare running costs with what you use now, and the grant depends on the heating being replaced.',
  hp_emitters:
    'Heat pumps run cooler than boilers, so some radiators may need upgrading to keep rooms warm.',
  hp_hot_water:
    'Heat pumps heat water into a tank, so a home with a combi boiler needs a hot water cylinder.',
  budget_band: 'It lets me show the options that fit, and flag any that go over.',
};

/** The reason for a question, or null when there is none to show. */
export function whyFor(questionId: string | null, engine: WhyEngine | null): string | null {
  if (!questionId) return null;
  const why = WHY[questionId];
  if (!why) return null;
  if (typeof why === 'string') return why;
  return (engine ? why[engine] : undefined) ?? why.default ?? null;
}
