import type { Metadata } from "next";
import Link from "next/link";
import raw from "../../../content/teardowns/transactional-email-apis.json";
import { getPostBySlug, getRelatedPosts } from "../../../lib/blog";
import { sharePct, type TeardownData } from "../../../lib/teardown";
import {
  CitedSources,
  EngineQuote,
  EngineSplit,
  MethodBox,
  ShareChart,
  TeardownCta,
} from "../_components/teardown";

const SITE_URL = "https://openllmrank.io";
const SLUG = "transactional-email-apis";
const post = getPostBySlug(SLUG)!;
const data = raw as TeardownData;

// Read by hand from the run's answers, not computed by the extractor, because
// Sequenzy was not a tracked brand: the counted answers whose text names
// Sequenzy, and how many of sequenzy.com's citations came from Perplexity.
const SEQUENZY_NAMED = 6;
const SEQUENZY_PERPLEXITY_CITATIONS = 30;

const total = data.run.answers;
const count = (name: string) => data.brands.find((b) => b.name === name)?.answers ?? 0;
const pct = (name: string) => sharePct(count(name), total);
const engineOf = (provider: string) => data.by_engine.find((e) => e.provider === provider)!;
const inEngine = (provider: string, brand: string) =>
  engineOf(provider).brands.find((b) => b.name === brand)?.answers ?? 0;
const domain = (d: string) => data.domains.find((x) => x.domain === d)!;
const quoteBy = (provider: string) => data.quotes.find((q) => q.provider === provider)!;

// Engines that named Resend in every one of their answers.
const resendEverywhere = data.by_engine.filter((e) => inEngine(e.provider, "Resend") === e.answers);
const chatgpt = engineOf("openai");
const perEngine = chatgpt.answers;
const sequenzy = domain("sequenzy.com");
const resendSite = domain("resend.com");
const lovableDocs = domain("docs.lovable.dev");

export const metadata: Metadata = {
  title: post.title,
  description: post.description,
  keywords: post.keywords,
  alternates: { canonical: `/blog/${SLUG}` },
  openGraph: {
    type: "article",
    url: `${SITE_URL}/blog/${SLUG}`,
    siteName: "openllmrank",
    title: post.title,
    description: post.description,
    publishedTime: post.date,
    modifiedTime: post.dateModified ?? post.date,
  },
  twitter: {
    card: "summary_large_image",
    title: post.title,
    description: post.description,
  },
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "Which email API do AI engines recommend for sending app emails?",
    a: `Resend. It was named in ${count("Resend")} of ${total} answers (${pct("Resend")}%) across ChatGPT, Claude, Gemini, Perplexity and Grok, ahead of Postmark (${pct("Postmark")}%), Amazon SES (${pct("Amazon SES")}%) and SendGrid (${pct("SendGrid")}%).`,
  },
  {
    q: "Does ChatGPT recommend Resend?",
    a: `Less than the other engines do. ChatGPT named Resend in ${inEngine("openai", "Resend")} of its ${perEngine} answers, and named Mailgun (${inEngine("openai", "Mailgun")}) and Postmark (${inEngine("openai", "Postmark")}) more often. The other four engines named Resend in all ${perEngine} of theirs.`,
  },
  {
    q: "Where do AI engines get email API recommendations from?",
    a: `Mostly from comparison posts on vendors' own blogs, plus the docs of the platforms people build on. The most cited site was sequenzy.com, cited in ${sequenzy.answers} of ${total} answers, more than resend.com (${resendSite.answers}).`,
  },
];

export default function EmailApiTeardown() {
  const related = getRelatedPosts(SLUG);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.dateModified ?? post.date,
    author: { "@type": "Organization", name: "openllmrank", url: SITE_URL },
    publisher: { "@type": "Organization", name: "openllmrank", url: SITE_URL },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/blog/${SLUG}` },
    keywords: post.keywords.join(", "),
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <article className="post">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span className="sep" aria-hidden>/</span>
        <Link href="/blog">Blog</Link>
        <span className="sep" aria-hidden>/</span>
        <span>Email API teardown</span>
      </nav>

      <h1>{post.title}</h1>
      <p className="post-meta">
        AI search teardown &middot; data from {data.run.date} &middot; {post.readingTime}
      </p>

      <p className="lede">
        If you build apps with an AI assistant, sooner or later it has to send a signup or
        password reset email, and you ask it which service to use. We asked ChatGPT, Claude,
        Gemini, Perplexity and Grok {data.run.questions.length} versions of that question,{" "}
        {data.run.samples} times each: {total} answers. One provider won almost everywhere. The
        source the engines leaned on most was a company that wasn&rsquo;t even on our list.
      </p>

      <h2>Three Findings, Up Front</h2>
      <ul>
        <li>
          <strong>Resend is the default.</strong> It was named in {count("Resend")} of {total}{" "}
          answers ({pct("Resend")}%), and in every single answer from{" "}
          {resendEverywhere.length} of the 5 engines.
        </li>
        <li>
          <strong>ChatGPT is the exception.</strong> It named Resend in {inEngine("openai", "Resend")}{" "}
          of {perEngine} answers, behind Mailgun ({inEngine("openai", "Mailgun")}) and Postmark (
          {inEngine("openai", "Postmark")}). If you ask ChatGPT, you get a different default.
        </li>
        <li>
          <strong>A vendor blog wrote the answers.</strong> The most cited site was sequenzy.com,
          in {sequenzy.answers} of {total} answers, ahead of resend.com itself (
          {resendSite.answers}). Sequenzy has a comparison post for nearly every question we
          asked, and the engines named it in {SEQUENZY_NAMED} answers.
        </li>
      </ul>

      <ShareChart
        title={`Resend is named in ${pct("Resend")}% of AI answers about sending app email`}
        unit={`Share of ${total} answers whose text names each provider · ${data.run.engines.length} engines · ${data.run.date}`}
        rows={data.brands}
        total={total}
      />

      <h2>ChatGPT Goes Its Own Way</h2>
      <p>
        Claude, Gemini, Perplexity and Grok named Resend in every answer. ChatGPT spreads its
        picks across the older providers, and reaches for Postmark when the job is signup and
        password reset email:
      </p>
      <EngineQuote quote={quoteBy("openai")} />
      <EngineSplit data={data} />
      <p>
        The other engines are close to unanimous. Gemini, asked which provider works best for
        apps built with Lovable or Bolt, put it this way:
      </p>
      <EngineQuote quote={quoteBy("google")} />

      <h2>The Vendor Blog Behind the Answers</h2>
      <p>
        Grounded engines search the web before they answer, then cite what they read. For email
        APIs, the page they read most belongs to Sequenzy, an email platform. Its blog has a post
        for almost every question in this test: best transactional email services, email tools
        for Lovable, for bolt.new, for Supabase, sending email from Next.js.
      </p>
      <CitedSources data={data} limit={10} />
      <p>
        sequenzy.com was cited {sequenzy.citations} times across {sequenzy.answers} answers, about{" "}
        {SEQUENZY_PERPLEXITY_CITATIONS} of those citations from Perplexity. It pays off. Sequenzy
        was not one of the providers we tracked, yet the engines recommended it by name in{" "}
        {SEQUENZY_NAMED} answers:
      </p>
      <EngineQuote quote={quoteBy("anthropic")} />
      <p>
        The platforms themselves shape the answer too. Lovable&rsquo;s docs were cited in{" "}
        {lovableDocs.answers} answers. If a builder platform documents one email provider, that
        provider inherits the platform&rsquo;s authority in AI answers.
      </p>

      <TeardownCta category="sending app email" />

      <h2>What This Means If You Sell to Builders</h2>
      <ul>
        <li>
          <strong>Write the page for the exact question.</strong> Sequenzy didn&rsquo;t write one
          &ldquo;best email API&rdquo; post. It wrote one per platform and stack, and each one
          matches a question builders actually ask.
        </li>
        <li>
          <strong>Get into the platform docs.</strong> Lovable&rsquo;s and Bolt&rsquo;s own docs and
          support pages are in the cited list above. An integration guide there is worth more
          than another page on your own site.
        </li>
        <li>
          <strong>Check ChatGPT on its own.</strong> A blended number hides that the biggest
          engine disagrees with the other four. Measure per engine.
        </li>
      </ul>
      <p>
        Disclosure: openllmrank sends its own email through Postmark, and sells the kind of
        AI-visibility measurement used in this post.
      </p>

      <MethodBox data={data} />

      <h2>Frequently Asked Questions</h2>
      {FAQ.map((f) => (
        <div key={f.q}>
          <h3>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}

      <div className="post-end">
        {related.length > 0 && (
          <div className="related">
            <h2>Keep reading</h2>
            <div className="related-list">
              {related.map((r) => (
                <Link key={r.slug} href={`/blog/${r.slug}`}>
                  {r.title}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
