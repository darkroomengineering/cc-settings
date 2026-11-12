/** The AI search indexers: they decide whether a page can be cited in an answer. */
const SEARCH_BOTS = [
  "OAI-SearchBot",
  "Claude-SearchBot",
  "PerplexityBot",
] as const;

/** The crawlers that collect pages to train models on. Google-Extended and Applebot-Extended are tokens only, read by Googlebot and Applebot. */
const TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Meta-ExternalAgent",
  "Bytespider",
] as const;

/** What `robots.txt` lets the AI crawlers do. Only an indexable build writes it. */
export interface AeoOptions {
  /** AI search indexers may crawl. Default `true`. */
  search?: boolean | undefined;
  /** AI training crawlers may crawl. Default: they may, and `Content-Signal` states no `ai-train`. */
  train?: boolean | undefined;
}

/** The AI part of `robots.txt`: `RobotsRules` of `@visio/router`. */
export interface RobotsRules {
  all: string[];
  groups: string[][];
}

function yesNo(on: boolean): string {
  return on ? "yes" : "no";
}

export function robotsRules(options: AeoOptions = {}): RobotsRules {
  const search = options.search ?? true;
  const train = options.train ?? true;
  const signal = [`search=yes`, `ai-input=${yesNo(search)}`];

  if (options.train !== undefined) {
    signal.push(`ai-train=${yesNo(train)}`);
  }

  const blocked = [
    ...(search ? [] : SEARCH_BOTS),
    ...(train ? [] : TRAINING_BOTS),
  ];

  return {
    all: [`Content-Signal: ${signal.join(", ")}`],
    groups: blocked.length
      ? [[...blocked.map((bot) => `User-agent: ${bot}`), "Disallow: /"]]
      : [],
  };
}
