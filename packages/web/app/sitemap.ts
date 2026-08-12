import type { MetadataRoute } from "next";
import { getAllPosts } from "../lib/blog";

const SITE_URL = "https://openllmrank.io";

// Last substantive edit to the legal pages. A literal, not new Date(): these
// pages change when we change them, not when we deploy.
const LEGAL_LAST_MODIFIED = new Date("2026-07-16T00:00:00Z");

// Only public, indexable marketing/legal/blog pages belong here. The wizard,
// checkout, and per-id report pages are private funnel/app routes and are
// excluded (and disallowed in robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const allPosts = getAllPosts();

  // The homepage and the blog index both list posts, so both genuinely change
  // when a post ships — and only then. Deriving lastmod from the newest post
  // keeps it honest. Previously this was new Date(), which stamped a fresh
  // lastmod on every deploy and taught Google to ignore the field entirely.
  const newest = allPosts[0];
  const lastModified = newest
    ? new Date(`${newest.dateModified ?? newest.date}T00:00:00Z`)
    : LEGAL_LAST_MODIFIED;

  const posts: MetadataRoute.Sitemap = allPosts.map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(`${post.dateModified ?? post.date}T00:00:00Z`),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...posts,
    {
      url: `${SITE_URL}/privacy`,
      lastModified: LEGAL_LAST_MODIFIED,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: LEGAL_LAST_MODIFIED,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
