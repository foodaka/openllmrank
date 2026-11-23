import type { Metadata } from "next";
import Link from "next/link";
import { competitors, formatChecked, OUR_PRODUCT } from "../../lib/compare";
import { COMPARE_CSS } from "../vs/_components/compare-css";

const SITE_URL = "https://openllmrank.io";
const TITLE = "AI Visibility Tool Alternatives: Pricing Compared (2026)";
const DESCRIPTION =
  "Profound, Peec AI, Otterly.AI, and AI SEO Tracker compared with openllmrank on price, engines, and refresh cadence, from each vendor's own pricing page. Includes when each one is the better pick.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} — openllmrank` },
  description: DESCRIPTION,
  alternates: { canonical: "/alternatives" },
  openGraph: { type: "website", url: `${SITE_URL}/alternatives`, siteName: "openllmrank", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function AlternativesPage() {
  // All entries are checked together; show the oldest so the date never overstates freshness.
  const checked = formatChecked([...competitors].map((c) => c.checked).sort()[0]!);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: TITLE,
    itemListElement: competitors.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE_URL}/vs/${c.slug}`,
      name: `${c.name} vs openllmrank`,
    })),
  };

  return (
    <article className="post">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link> / Compare
      </nav>
      <h1>AI visibility tools compared</h1>
      <p className="post-meta">By openllmrank · Vendor pages checked {checked}</p>
      <p className="lede">
        AI visibility tools split into two groups. Enterprise and volume platforms track hundreds of prompts daily,
        including Google AI Overviews. Lighter tools run a smaller, repeatable benchmark for a lower price.
        openllmrank is in the second group: {OUR_PRODUCT.trackingPrice} for weekly runs across five grounded model
        APIs, or {OUR_PRODUCT.reportPrice}.
      </p>
      <p>
        We build openllmrank. Each competitor&rsquo;s numbers come from its own pricing page, read on {checked}, and
        each comparison lists the situations where that tool is the better choice.
      </p>

      <h2>Price, engines, and cadence</h2>
      <p className="post-meta">On small screens, scroll the table sideways.</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="AI visibility tools comparison, scroll horizontally">
        <table className="compare-table hub-table">
          <caption>Entry price and coverage from each vendor&rsquo;s pricing page, checked {checked}</caption>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">Entry price</th>
              <th scope="col">Engines</th>
              <th scope="col">Refresh</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">openllmrank</th>
              <td className="us">{OUR_PRODUCT.trackingPrice}; {OUR_PRODUCT.reportPrice} report</td>
              <td className="us">{OUR_PRODUCT.engines}</td>
              <td className="us">{OUR_PRODUCT.cadence}</td>
            </tr>
            {competitors.map((c) => (
              <tr key={c.slug}>
                <th scope="row"><Link href={`/vs/${c.slug}`}>{c.name}</Link></th>
                <td>{c.summary.entryPrice}</td>
                <td>{c.summary.engines}</td>
                <td>{c.summary.cadence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Head-to-head comparisons</h2>
      <ul className="alt-list">
        {competitors.map((c) => (
          <li key={c.slug}>
            <h3><Link href={`/vs/${c.slug}`}>{c.name} vs openllmrank</Link></h3>
            <p>{c.description}</p>
          </li>
        ))}
      </ul>

      <h2>Where openllmrank is not the right pick</h2>
      <ul>
        <li>You need Google AI Overviews, Google AI Mode, or Microsoft Copilot measured.</li>
        <li>You track hundreds of prompts and need them refreshed daily.</li>
        <li>You need SSO, an SLA, or content generation in the same tool.</li>
      </ul>
      <p>
        For a broader list that includes Athena HQ and Ahrefs Brand Radar, see{" "}
        <Link href="/blog/best-ai-search-visibility-tools">AI search visibility tools compared</Link>.
      </p>

      <div className="post-cta">
        <h3>Try it before you compare further</h3>
        <p>The free snapshot shows whether AI engines name your brand for a few buying questions. No card.</p>
        <Link href="/snapshot" className="btn-primary" data-cta-location="alternatives">Get a free AI snapshot</Link>
        <p className="td-cta-alt">
          Or <Link href="/check">check whether AI crawlers can read your site</Link>, also free.
        </p>
      </div>

      <style>{COMPARE_CSS}</style>
    </article>
  );
}
