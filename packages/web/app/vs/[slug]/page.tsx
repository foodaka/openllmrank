import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { competitors, formatChecked, getCompetitor, OUR_PRODUCT } from "../../../lib/compare";
import { COMPARE_CSS } from "../_components/compare-css";

const SITE_URL = "https://openllmrank.io";

// Only the competitors in the registry exist; any other /vs/<x> is a real 404,
// not a soft-404 render of an empty template.
export const dynamicParams = false;

export function generateStaticParams() {
  return competitors.map((c) => ({ slug: c.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = getCompetitor((await params).slug);
  if (!c) return {};
  const url = `${SITE_URL}/vs/${c.slug}`;
  return {
    title: c.title,
    description: c.description,
    alternates: { canonical: `/vs/${c.slug}` },
    openGraph: { type: "article", url, siteName: "openllmrank", title: c.title, description: c.description, modifiedTime: c.checked },
    twitter: { card: "summary_large_image", title: c.title, description: c.description },
  };
}

export default async function VsPage({ params }: Props) {
  const c = getCompetitor((await params).slug);
  if (!c) notFound();
  const checked = formatChecked(c.checked);
  const others = competitors.filter((o) => o.slug !== c.slug);
  const url = `${SITE_URL}/vs/${c.slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: c.title,
        description: c.description,
        dateModified: c.checked,
        author: { "@type": "Organization", name: "openllmrank", url: SITE_URL },
        publisher: { "@id": `${SITE_URL}/#organization` },
        mainEntityOfPage: url,
      },
      {
        "@type": "FAQPage",
        mainEntity: c.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <article className="post">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link> / <Link href="/alternatives">Compare</Link> / {c.name}
      </nav>
      <h1>{c.name} vs openllmrank</h1>
      <p className="post-meta">By openllmrank · Vendor pages checked {checked}</p>
      <p className="lede verdict">{c.verdict}</p>
      <p>
        We build openllmrank, so read this as a vendor comparison, not a neutral review. Every claim about {c.name} below
        comes from its own website, linked inline and read on {checked}. We have not tested {c.name} hands-on. Prices
        change; check <a href={c.pricingUrl}>{c.domain}</a> before you buy.
      </p>

      <h2>{c.name} vs openllmrank at a glance</h2>
      <p className="post-meta">On small screens, scroll the table sideways.</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={`${c.name} vs openllmrank comparison, scroll horizontally`}>
        <table className="compare-table">
          <caption>Published product information, checked {checked}</caption>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col">{c.name}</th>
              <th scope="col" className="us">openllmrank</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.them}</td>
                <td className="us">{row.us}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Which one should you pick?</h2>
      <div className="pick-grid">
        <section>
          <h3>Pick {c.name} if</h3>
          <ul>{c.pickThemIf.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
        <section>
          <h3>Pick openllmrank if</h3>
          <ul>{c.pickUsIf.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      </div>

      <div className="post-cta">
        <h3>See where your brand stands first</h3>
        <p>
          The free snapshot asks AI engines a few buying questions about your category and shows whether you make the
          shortlist. No card. Tracking is {OUR_PRODUCT.trackingPrice} if you want it weekly.
        </p>
        <Link href="/snapshot" className="btn-primary" data-cta-location={`vs_${c.slug}`}>Get a free AI snapshot</Link>
        <p className="td-cta-alt">
          Or <Link href="/sample-report.html">view a sample report</Link> to see what a paid run contains.
        </p>
      </div>

      <h2>What {c.name} publishes about itself</h2>
      <ul className="facts">
        {c.facts.map((f) => (
          <li key={f.text}>
            {f.text} <a href={f.source}>Source</a>
          </li>
        ))}
      </ul>

      <h2>Honest limits, including ours</h2>
      <ul>
        <li>openllmrank queries grounded provider APIs. Answers there can differ from what a logged-in user sees in the ChatGPT, Claude, or Gemini apps.</li>
        <li>openllmrank does not measure Google AI Overviews, Google AI Mode, or Microsoft Copilot.</li>
        <li>The hosted plan runs up to {OUR_PRODUCT.maxPrompts} questions per brand. Teams tracking hundreds of prompts need a bigger tool or the self-hosted CLI.</li>
        <li>Where {c.name}&rsquo;s site does not state something, the table says &ldquo;not stated&rdquo; rather than guessing.</li>
      </ul>
      <p>
        How we measure, including sample sizes and what we cannot see, is on the <Link href="/methodology">methodology page</Link>.
      </p>

      <h2>Frequently asked</h2>
      {c.faq.map((f) => (
        <div key={f.q}>
          <h3>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}

      <footer className="post-end related">
        <h2>Other comparisons</h2>
        <div className="related-list">
          {others.map((o) => (
            <Link key={o.slug} href={`/vs/${o.slug}`}>{o.name} vs openllmrank</Link>
          ))}
          <Link href="/alternatives">All AI visibility tools compared</Link>
          <Link href="/blog/best-ai-search-visibility-tools">AI search visibility tools compared: pricing and features</Link>
        </div>
      </footer>

      <style>{COMPARE_CSS}</style>
    </article>
  );
}
