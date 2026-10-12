/**
 * robots.txt, read the way a polite crawler reads it.
 *
 * Only the parts that matter for one bot on one site: the group that names us
 * (`SunnyBot`) if there is one, otherwise the `*` group; `Disallow` and `Allow`
 * prefixes with `*` and `$` wildcards; longest match wins, Allow breaks ties.
 * A missing or unreadable robots.txt allows everything, which is the convention.
 */

export interface RobotsRules {
  allowed(path: string): boolean;
  sitemaps: string[];
}

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

function toRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped.endsWith('\\$') ? `${escaped.slice(0, -2)}$` : escaped}`);
}

export function parseRobots(text: string, agent = 'sunnybot'): RobotsRules {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if ((key === 'disallow' || key === 'allow') && value !== '') {
      current.rules.push({ allow: key === 'allow', pattern: value, regex: toRegex(value) });
    }
  }

  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const fallback = groups.find((g) => g.agents.includes('*'));
  const rules = (mine ?? fallback)?.rules ?? [];

  return {
    sitemaps,
    allowed(path: string): boolean {
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!rule.regex.test(path)) continue;
        if (
          !best ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow)
        ) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}
