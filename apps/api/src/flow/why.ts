/**
 * Why Sunny asks each of its own questions, in a sentence or two the visitor
 * can open from the ⓘ beside the question. A question asked without its reason
 * can feel like prying (ownership, the address); with it, it reads as help.
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
  annual_kwh:
    'Most of the saving comes from the solar power you use yourself, so your usage sets the right size of system.',
  monthly_cost:
    'Your bill tells me roughly how much electricity you use, which sets the right size of system.',
  household_size:
    "If you're not sure of your usage, the number of people at home gives a good typical figure.",
  lifestyle:
    'When you use electricity matters. If you are out in the day, a battery stores the solar power for the evening.',
  existing_system: "If you already have panels or a battery, I'll size the new system around them.",
  tariff_type: 'Your tariff changes how much each unit of solar power saves you.',
  property_type: {
    default: 'The type of home helps the installer plan access and scaffolding.',
    heat_pump:
      'The type of home affects how much heat it loses, which sets the size of heat pump you need.',
  },
  hp_age: 'Older homes usually lose more heat, so the age helps size the heat pump.',
  hp_bedrooms:
    "The number of bedrooms gives a good idea of the home's size and how much hot water you use.",
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
