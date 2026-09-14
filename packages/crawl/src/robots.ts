// robots.txt analysis: crawlability rules, the bot roster (search engines,
// AI search bots, AI training bots — deliberately separate categories, see
// types.ts), and sitemap discovery.

import robotsParser from "robots-parser";
import {
  AI_SEARCH_BOTS,
  AI_TRAINING_BOTS,
  SEARCH_ENGINE_BOTS,
  type BotAccess,
} from "./types";

export type RobotsInfo = {
  found: boolean;
  /** True when `User-agent: *` disallows the site root. */
  blocksAll: boolean;
  /** Sitemap URLs declared in robots.txt. */
  sitemaps: string[];
  botAccess: BotAccess[];
  /** True when OUR crawler may fetch the given URL. */
  isAllowed: (url: string) => boolean;
};

export const CRAWLER_UA = "openllmrank-crawlcheck";

/**
 * Parse robots.txt content. Pass `found: false` semantics by calling with
 * null content — everything is allowed and that fact is reported.
 */
export function analyzeRobots(robotsUrl: string, content: string | null): RobotsInfo {
  if (content === null) {
    return {
      found: false,
      blocksAll: false,
      sitemaps: [],
      botAccess: allBots().map((b) => ({ ...b, allowed: true })),
      isAllowed: () => true,
    };
  }

  const parser = robotsParser(robotsUrl, content);
  const origin = new URL(robotsUrl).origin;

  const access = allBots().map((b) => ({
    ...b,
    // isAllowed returns undefined for malformed input — treat as allowed.
    allowed: parser.isAllowed(`${origin}/`, b.bot) !== false,
  }));

  // "Blocks all" must mean ALL: `User-agent: * Disallow: /` plus a specific
  // `Allow` for Googlebot is a common config that blocks the wildcard group
  // but not the bots that matter — reporting that site as "invisible by
  // configuration" would be a false critical (adversarial finding 7).
  const wildcardBlocked = parser.isAllowed(`${origin}/`, "AnythingBot") === false;
  const everyRosterBotBlocked = access.every((b) => !b.allowed);

  return {
    found: true,
    blocksAll: wildcardBlocked && everyRosterBotBlocked,
    sitemaps: parser.getSitemaps(),
    botAccess: access,
    isAllowed: (url: string) => parser.isAllowed(url, CRAWLER_UA) !== false,
  };
}

function allBots(): Array<Omit<BotAccess, "allowed">> {
  return [
    ...SEARCH_ENGINE_BOTS.map((bot) => ({ bot, category: "search_engine" as const })),
    ...AI_SEARCH_BOTS.map((bot) => ({ bot, category: "ai_search" as const })),
    ...AI_TRAINING_BOTS.map((bot) => ({ bot, category: "ai_training" as const })),
  ];
}
