/**
 * robots.txt, per RFC 9309: the group for our user agent if there is one,
 * otherwise `*`; within it the longest matching rule wins, and `Allow` wins
 * a tie. `*` and `$` work as wildcards in paths.
 */

export type Robots = {
  sitemaps: string[];
  /** Seconds, from `Crawl-delay` in the chosen group. */
  crawlDelay: number | null;
  /** The chosen group's rules, kept so the result survives JSON (a Workflow step return). */
  rules: { allow: boolean; path: string }[];
};

export const EMPTY_ROBOTS: Robots = { sitemaps: [], crawlDelay: null, rules: [] };

type Group = { agents: string[]; rules: { allow: boolean; path: string }[]; crawlDelay: number | null };

export function parseRobots(text: string, agent: string): Robots {
  const sitemaps: string[] = [];
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow allows everything; it adds no rule.
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    }
  }

  const token = agent.toLowerCase().split('/')[0]!;
  const ours = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = ours.length ? ours : groups.filter((g) => g.agents.includes('*'));
  return {
    sitemaps,
    crawlDelay: chosen.find((g) => g.crawlDelay !== null)?.crawlDelay ?? null,
    rules: chosen.flatMap((g) => g.rules),
  };
}

function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}

/** Whether robots allows a URL's path (and query). */
export function robotsAllows(robots: Robots, url: string): boolean {
  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    return false;
  }
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of robots.rules) {
    if (!ruleMatches(rule.path, path)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best?.allow ?? true;
}
