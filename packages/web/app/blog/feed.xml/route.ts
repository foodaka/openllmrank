import { getAllPosts } from "../../../lib/blog";

// RSS 2.0 feed for the blog.
//
// Feeds are a discovery surface the sitemap is not: aggregators, readers, and
// the crawlers that follow them poll a feed and fetch new items directly, which
// is a second path to a post that does not depend on Google spending crawl
// budget on the blog index first.

const SITE_URL = "https://openllmrank.io";
const FEED_TITLE = "openllmrank — Field notes on AI search visibility";
const FEED_DESCRIPTION =
  "Field notes on AI search visibility and answer engine optimization (AEO): how ChatGPT, Perplexity, and Gemini decide which brands to recommend.";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc822(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toUTCString();
}

export const dynamic = "force-static";

export function GET(): Response {
  const posts = getAllPosts();
  const lastBuildDate = posts[0]
    ? toRfc822(posts[0].dateModified ?? posts[0].date)
    : new Date(0).toUTCString();

  const items = posts
    .map((post) => {
      const url = `${SITE_URL}/blog/${post.slug}`;
      const categories = post.tags
        .map((tag) => `      <category>${escapeXml(tag)}</category>`)
        .join("\n");
      return [
        "    <item>",
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <description>${escapeXml(post.description)}</description>`,
        `      <pubDate>${toRfc822(post.date)}</pubDate>`,
        categories,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${SITE_URL}/blog</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
