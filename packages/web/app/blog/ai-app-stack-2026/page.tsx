import type { Metadata } from "next";
import Link from "next/link";
import raw from "../../../content/teardowns/ai-app-stack-2026.json";
import { getPostBySlug, getRelatedPosts } from "../../../lib/blog";
import { engineLabel, sharePct, type TeardownData } from "../../../lib/teardown";
import {
  CitedSources,
  EngineQuote,
  MethodBox,
  ShareChart,
  StackGrid,
  TeardownCta,
  layerLeader,
  type StackLayer,
} from "../_components/teardown";

const SITE_URL = "https://openllmrank.io";
const SLUG = "ai-app-stack-2026";
const post = getPostBySlug(SLUG)!;

// ChatGPT tags every link it writes into an answer with "?utm_source=openai",
// and the CLI's matcher counts that as naming OpenAI (6 ChatGPT answers). Hand
// recount of answers that really name OpenAI or openai.com: 19 overall, 5 from
// ChatGPT. Applied here so the hero grid and chart use the corrected numbers.
const OPENAI_NAMED = 19;
const OPENAI_NAMED_BY_CHATGPT = 5;
const fixOpenAI = (brands: TeardownData["brands"], n: number) =>
  brands.map((b) => (b.name === "OpenAI" ? { ...b, answers: n } : b)).sort((x, y) => y.answers - x.answers);
const data: TeardownData = {
  ...(raw as TeardownData),
  brands: fixOpenAI((raw as TeardownData).brands, OPENAI_NAMED),
  by_engine: (raw as TeardownData).by_engine.map((e) =>
    e.provider === "openai" ? { ...e, brands: fixOpenAI(e.brands, OPENAI_NAMED_BY_CHATGPT) } : e,
  ),
};

// The layers of the stack, each a list of tracked brands. Supabase sits in
// "Database / backend" only (it is named as one product for both database and
// auth), so "Auth" is the dedicated auth services. PostgreSQL and React are
// tracked but left out: they are technologies every vendor here builds on,
// not picks between vendors.
const LAYERS: StackLayer[] = [
  { label: "Framework", brands: ["Next.js", "SvelteKit", "Nuxt", "Remix", "React Native", "Expo", "Flutter", "Laravel", "Ruby on Rails", "Django", "FastAPI"] },
  { label: "Database / backend", brands: ["Supabase", "Firebase", "Neon", "PlanetScale", "Convex", "MongoDB Atlas", "Turso", "Xata"] },
  { label: "Hosting", brands: ["Vercel", "Netlify", "Railway", "Render.com", "Fly.io", "Cloudflare", "AWS Amplify", "AWS"] },
  { label: "Payments", brands: ["Stripe", "Lemon Squeezy", "Paddle", "Polar.sh", "Gumroad", "Creem"] },
  { label: "Auth", brands: ["Clerk", "Auth0", "Better Auth", "Kinde", "WorkOS", "Stack Auth", "NextAuth"] },
  { label: "Email", brands: ["Resend", "Postmark", "SendGrid"] },
  { label: "Analytics", brands: ["PostHog", "Plausible", "Google Analytics", "Mixpanel", "Amplitude", "Umami", "Vercel Analytics"] },
  { label: "Error monitoring", brands: ["Sentry", "LogRocket", "Highlight.io", "Bugsnag", "Better Stack"] },
  { label: "LLM API", brands: ["OpenAI", "Anthropic", "Google Gemini", "OpenRouter", "Groq", "Mistral", "Together AI", "xAI", "DeepSeek"] },
  { label: "AI builder / coding tool", brands: ["Cursor", "Lovable", "Bolt.new", "v0", "Claude Code", "Replit", "Bubble", "FlutterFlow"] },
];

// Read by hand from the run's answers, not computed by the extractor.
// Answers whose text names all four of Next.js, Supabase, Vercel and Stripe,
// overall and within the three "what stack" questions (3 x 15 = 45 answers).
const FOUR_TOGETHER = 51;
const FOUR_TOGETHER_STACK_QS = 42;
const STACK_QS_ANSWERS = 45;
// Answers naming any AI app builder or AI coding tool (Lovable, Bolt, v0,
// Cursor, Replit, Bubble, FlutterFlow, Claude Code, Windsurf, Copilot), per engine.
const BUILDER_ANSWERS = { openai: 1, anthropic: 4, google: 11, perplexity: 7, xai: 9 };
// The AI-app question only (3 answers per engine): answers naming each model
// maker, counting the model names too ("Claude", "GPT-4o", "Gemini", "Grok").
const AI_Q_SAMPLES = 3;
const MAKER_NAMED = {
  openai: { OpenAI: 3, Anthropic: 1, Google: 0, xAI: 0 },
  anthropic: { OpenAI: 3, Anthropic: 3, Google: 0, xAI: 0 },
  google: { OpenAI: 3, Anthropic: 3, Google: 0, xAI: 0 },
  perplexity: { OpenAI: 0, Anthropic: 0, Google: 0, xAI: 0 },
  xai: { OpenAI: 3, Anthropic: 3, Google: 1, xAI: 0 },
};
// Answers that name a specific model version, and how many of those name a
// 2024-era one (GPT-4o, GPT-4o-mini, GPT-3.5, Claude 3.5 Sonnet).
const MODEL_VERSION_ANSWERS = 8;
const OLD_MODEL_ANSWERS = 7;
// "Render" (capitalised, the hosting company) is tracked as Render.com so the
// verb doesn't count; answers naming Render by hand: 11.
const RENDER_NAMED = 11;
// Answers that say "Supabase Auth" in so many words.
const SUPABASE_AUTH_NAMED = 25;
// Citations: Perplexity returned 396 of the run's 807 cited links; ChatGPT
// returned 28, 9 of them on nextjs.org.
const ALL_CITATIONS = 807;
const PERPLEXITY_CITATIONS = 396;
const CHATGPT_CITATIONS = 28;
const CHATGPT_NEXTJS_CITATIONS = 9;

const total = data.run.answers;
const count = (name: string) => data.brands.find((b) => b.name === name)?.answers ?? 0;
const pct = (name: string) => sharePct(count(name), total);
const engineOf = (provider: string) => data.by_engine.find((e) => e.provider === provider)!;
const inEngine = (provider: string, brand: string) =>
  engineOf(provider).brands.find((b) => b.name === brand)?.answers ?? 0;
const domain = (d: string) => data.domains.find((x) => x.domain === d)!;
const quoteBy = (provider: string, contains = "") =>
  data.quotes.find((q) => q.provider === provider && q.text.includes(contains))!;

const perEngine = engineOf("openai").answers;
const fourPct = sharePct(FOUR_TOGETHER, total);
// The default pick per layer, across all engines, for the hero chart.
const layerDefaults = LAYERS.map((l) => ({ layer: l.label, lead: layerLeader(data.brands, l)! }))
  .sort((a, b) => b.lead.answers - a.lead.answers);
const appypie = domain("appypie.com");
const makerkit = domain("makerkit.dev");
const lemonElsewhere = ["openai", "anthropic", "perplexity"].reduce((n, p) => n + inEngine(p, "Lemon Squeezy"), 0);
const mindstudio = domain("mindstudio.ai");

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
    q: "What tech stack do AI engines recommend for building an app in 2026?",
    a: `Next.js, Supabase, Vercel and Stripe. Across ${total} answers from ChatGPT, Claude, Gemini, Perplexity and Grok, Supabase was named in ${pct("Supabase")}%, Vercel in ${pct("Vercel")}%, Next.js in ${pct("Next.js")}% and Stripe in ${pct("Stripe")}%, and ${FOUR_TOGETHER} answers named all four together. Resend (email), Clerk (auth) and PostHog (analytics) were the most common add-ons.`,
  },
  {
    q: "Do AI engines recommend their own maker's models?",
    a: `Not in this run. Asked what to use to build an AI app, Gemini named OpenAI and Anthropic models in all ${AI_Q_SAMPLES} of its answers and its own Gemini in none, and Grok never named Grok or xAI in any of its ${perEngine} answers. ChatGPT leaned closest to home: OpenAI in ${MAKER_NAMED.openai.OpenAI} of ${AI_Q_SAMPLES}, Anthropic in ${MAKER_NAMED.openai.Anthropic}. The samples are small, so read this as a direction, not a rate.`,
  },
  {
    q: "Which AI engine recommends a different stack?",
    a: `They agree on the core stack, and split on how to build it. ChatGPT named an AI app builder or AI coding tool (Lovable, Bolt, v0, Cursor and the like) in ${BUILDER_ANSWERS.openai} of its ${perEngine} answers; Gemini did in ${BUILDER_ANSWERS.google}. Gemini was also the only engine to push Lemon Squeezy, in ${inEngine("google", "Lemon Squeezy")} of its ${perEngine} answers.`,
  },
];

export default function AppStackTeardown() {
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
        <span>App stack teardown</span>
      </nav>

      <h1>{post.title}</h1>
      <p className="post-meta">
        AI search teardown &middot; data from {data.run.date} &middot; {post.readingTime}
      </p>

      <p className="lede">
        More and more apps start with a question to an AI: what should I build this with? We asked
        ChatGPT, Claude, Gemini, Perplexity and Grok {data.run.questions.length} versions of it,{" "}
        {data.run.samples} times each: {total} answers. They don&rsquo;t give you a menu. They give
        you the same four products, and on the rest of the stack they disagree in ways worth
        knowing.
      </p>

      <h2>Three Findings, Up Front</h2>
      <ul>
        <li>
          <strong>There is one default stack.</strong> Next.js, Supabase, Vercel and Stripe were
          named together in {FOUR_TOGETHER} of {total} answers ({fourPct}%). Asked directly what
          stack to use, {FOUR_TOGETHER_STACK_QS} of {STACK_QS_ANSWERS} answers named all four.
        </li>
        <li>
          <strong>Engines barely push their own models.</strong> Asked what to build an AI app with,
          Gemini named OpenAI and Claude in all {AI_Q_SAMPLES} answers and Gemini in none. Grok
          never named Grok. Only ChatGPT leaned home: OpenAI {MAKER_NAMED.openai.OpenAI} of{" "}
          {AI_Q_SAMPLES}, Anthropic {MAKER_NAMED.openai.Anthropic}.
        </li>
        <li>
          <strong>ChatGPT leaves out the AI builders.</strong> It named Lovable, Bolt, v0,
          Cursor or a similar tool in {BUILDER_ANSWERS.openai} of {perEngine} answers. Gemini
          named one in {BUILDER_ANSWERS.google}, Grok in {BUILDER_ANSWERS.xai}.
        </li>
      </ul>

      <h2>The Stack Each Engine Would Build You</h2>
      <p>
        For every layer of an app, the product each engine named most often, out of its{" "}
        {perEngine} answers. Read across a row to see where the engines agree; read down a column
        for one engine&rsquo;s whole stack.
      </p>
      <StackGrid data={data} layers={LAYERS} />
      <p>
        The top four rows are close to unanimous. Supabase is the database in every column, and
        it is often the auth too: {SUPABASE_AUTH_NAMED} answers say &ldquo;Supabase Auth&rdquo;
        in so many words, so the Auth row shows the dedicated services the engines name next to
        it. ChatGPT&rsquo;s answer for a solo founder is the stack in one line:
      </p>
      <EngineQuote quote={quoteBy("openai")} />

      <ShareChart
        title={`The default pick in each layer of the stack`}
        unit={`Share of ${total} answers whose text names each product · ${data.run.engines.length} engines · ${data.run.date}`}
        rows={layerDefaults.map((d) => d.lead)}
        total={total}
        notes={Object.fromEntries(layerDefaults.map((d) => [d.lead.name, d.layer]))}
      />

      <h2>The Layers Below the Line</h2>
      <p>
        The further down the stack, the thinner the consensus. Resend is the email default, as it
        was in our <Link href="/blog/transactional-email-apis">email API teardown</Link>, but
        it was named in only {pct("Resend")}% of answers to these open questions. Analytics and
        error monitoring are left out more often still: PostHog was named in {pct("PostHog")}%
        of answers (Claude: {inEngine("anthropic", "PostHog")} of {perEngine}), Sentry in{" "}
        {pct("Sentry")}% (Gemini: {inEngine("google", "Sentry")}). If you sell monitoring, the
        engines aren&rsquo;t recommending against you. They mostly don&rsquo;t get that far.
      </p>
      <p>
        Hosting has a long tail behind Vercel: Railway ({count("Railway")} answers), Cloudflare (
        {count("Cloudflare")}), Fly.io ({count("Fly.io")}) and Render (about {RENDER_NAMED}, counted
        by hand). Payments has one quirk: Gemini named Lemon Squeezy in{" "}
        {inEngine("google", "Lemon Squeezy")} of its {perEngine} answers, as the merchant of record
        that handles sales tax. ChatGPT, Claude and Perplexity named it in{" "}
        {lemonElsewhere === 0 ? "none of theirs" : `${lemonElsewhere} of theirs`}.
      </p>

      <h2>The LLM Layer: No Home Cooking</h2>
      <p>
        We expected each engine to favour its own maker. It didn&rsquo;t. On the question about
        building an AI app ({AI_Q_SAMPLES} answers per engine), these are the answers naming each
        model maker, counting model names like Claude and GPT-4o. (ChatGPT tags the links in its
        answers with &ldquo;utm_source=openai&rdquo;; we don&rsquo;t count that as naming OpenAI.)
      </p>
      <div className="table-scroll">
        <table className="td-table">
          <thead>
            <tr>
              <th>Engine</th>
              <th className="td-num">OpenAI</th>
              <th className="td-num">Anthropic</th>
              <th className="td-num">Google</th>
              <th className="td-num">xAI</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(MAKER_NAMED).map(([provider, m]) => (
              <tr key={provider}>
                <td>
                  <strong>{engineLabel(provider)}</strong>
                </td>
                {(["OpenAI", "Anthropic", "Google", "xAI"] as const).map((k) => (
                  <td key={k} className="td-num">
                    {m[k]}/{AI_Q_SAMPLES}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        OpenAI and Anthropic are the default pair. Gemini, asked the question, recommended the
        competition:
      </p>
      <EngineQuote quote={quoteBy("google", "Claude 3.5")} />
      <p>
        Note the model names. Of the {MODEL_VERSION_ANSWERS} answers that named a specific model,{" "}
        {OLD_MODEL_ANSWERS} named a 2024-era one: GPT-4o, GPT-4o-mini, Claude 3.5 Sonnet. The
        engines recommend the right companies and the wrong versions, probably because many of the
        pages they read were written then. Perplexity named no model maker at all on this question.
      </p>

      <h2>How You Build It Depends on Who You Ask</h2>
      <p>
        Ask &ldquo;what are the best ways to build an app&rdquo; and the engines split. Gemini,
        Grok and Perplexity send you to AI builders and AI coding tools:
      </p>
      <EngineQuote quote={quoteBy("google", "Lovable")} />
      <p>
        ChatGPT almost never does ({BUILDER_ANSWERS.openai} of {perEngine}), and Claude names the
        older no-code tools instead ({BUILDER_ANSWERS.anthropic} of {perEngine}):
      </p>
      <EngineQuote quote={quoteBy("anthropic")} />
      <p>Perplexity folds the AI tools straight into its stack:</p>
      <EngineQuote quote={quoteBy("perplexity")} />

      <h2>Who Wrote the Pages the Engines Read</h2>
      <p>
        As in the email teardown, the most cited sites are vendors&rsquo; blogs, not
        documentation. appypie.com, an app builder, was cited in {appypie.answers} answers.
        mindstudio.ai, an AI agent platform, in {mindstudio.answers}. makerkit.dev, which sells a
        Next.js and Supabase starter kit, in {makerkit.answers}, including its own post on the 2026 SaaS stack.
      </p>
      <CitedSources data={data} limit={10} />
      <p>
        One caveat on this table: Perplexity returned {PERPLEXITY_CITATIONS} of the run&rsquo;s{" "}
        {ALL_CITATIONS} cited links, so it is mostly Perplexity&rsquo;s reading list (including a
        Finnish broadcaster&rsquo;s topic pages, which have nothing to do with apps). ChatGPT cited
        only {CHATGPT_CITATIONS} links in all {perEngine} answers, {CHATGPT_NEXTJS_CITATIONS} of
        them on nextjs.org.
      </p>

      <TeardownCta category="the app stack" />

      <h2>What This Means If You Sell to Builders</h2>
      <ul>
        <li>
          <strong>Integrate with the default, don&rsquo;t fight it.</strong> If {fourPct}% of
          answers start from Next.js, Supabase, Vercel and Stripe, the question builders ask next
          is &ldquo;what works with that stack.&rdquo; Have the page that answers it.
        </li>
        <li>
          <strong>Starter kits write the stack.</strong> A boilerplate vendor&rsquo;s post on the
          2026 SaaS stack is a source the engines read. Being in the kits, and in their
          posts, puts you in the answer.
        </li>
        <li>
          <strong>The lower layers are open.</strong> Analytics, monitoring and email are named
          in a minority of answers. Nobody owns them yet in AI answers, which makes them cheaper
          to win than the top four.
        </li>
        <li>
          <strong>Check each engine on its own.</strong> Gemini&rsquo;s Lemon Squeezy and
          ChatGPT&rsquo;s silence on AI builders vanish in a blended number.
        </li>
      </ul>
      <p>
        Disclosure: openllmrank is built on the default stack in this post: Next.js, Supabase
        (database and auth), Vercel (hosting and Vercel Analytics) and Stripe. It sends email
        through Postmark, calls the OpenAI, Anthropic, Google, Perplexity and xAI APIs, and sells
        the kind of AI-visibility measurement used in this post.
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
