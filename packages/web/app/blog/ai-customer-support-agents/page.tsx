import type { Metadata } from "next";
import Link from "next/link";
import raw from "../../../content/teardowns/ai-customer-support-agents.json";
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
const SLUG = "ai-customer-support-agents";
const post = getPostBySlug(SLUG)!;
const data = raw as TeardownData;

// The extractor counts across all questions, so the split between the two
// kinds of question was counted from the run's db (citations joined to
// prompts, text mentions only, the same rule as every other figure here).
// "Chatbot" questions: train a chatbot on my website and docs; add a
// ChatGPT-style chatbot to my website. "Agent" questions: take actions like
// refunds and order lookups; chat, email and voice; a Shopify store.
const CHATBOT_ANSWERS = 30;
const CHATBOT_CHATBASE = 20;
const CHATBOT_FIN = 14;
const AGENT_ANSWERS = 45;
const AGENT_CHATBASE = 8;
const AGENT_FIN = 33;
// The refunds-and-order-lookups question alone, 15 answers.
const ACTIONS_ANSWERS = 15;
const ACTIONS_CHATBASE = 2;
const ACTIONS_FIN = 14;
// Read by hand: of ChatGPT's 6 answers to the two chatbot questions, how many
// led with OpenAI's own stack (ChatKit, File Search, the Responses API).
const CHATGPT_CHATBOT_ANSWERS = 6;
const CHATGPT_OPENAI_FIRST = 4;

const total = data.run.answers;
const count = (name: string) => data.brands.find((b) => b.name === name)?.answers ?? 0;
const pct = (name: string) => sharePct(count(name), total);
const engineOf = (provider: string) => data.by_engine.find((e) => e.provider === provider)!;
const inEngine = (provider: string, brand: string) =>
  engineOf(provider).brands.find((b) => b.name === brand)?.answers ?? 0;
const domain = (d: string) => data.domains.find((x) => x.domain === d)!;
// The JSON's quotes, trimmed to these four in this order.
const [perplexityQuote, chatkitQuote, finQuote, sierraQuote] = data.quotes as [
  TeardownData["quotes"][number],
  TeardownData["quotes"][number],
  TeardownData["quotes"][number],
  TeardownData["quotes"][number],
];

const perEngine = engineOf("openai").answers;
const chatbaseSite = domain("chatbase.co");
const chatbotPct = sharePct(CHATBOT_CHATBASE, CHATBOT_ANSWERS);
const agentPct = sharePct(AGENT_CHATBASE, AGENT_ANSWERS);

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
    q: "Which AI customer support platform do AI engines recommend most?",
    a: `Intercom Fin. It was named in ${count("Intercom Fin")} of ${total} answers (${pct("Intercom Fin")}%) across ChatGPT, Claude, Gemini, Perplexity and Grok, ahead of Zendesk (${pct("Zendesk")}%), Tidio (${pct("Tidio")}%) and Chatbase (${pct("Chatbase")}%).`,
  },
  {
    q: "Do AI engines recommend Chatbase?",
    a: `For chatbots, yes: Chatbase was named in ${CHATBOT_CHATBASE} of ${CHATBOT_ANSWERS} answers about training a chatbot on a website or adding one to a site. For AI support agents, much less: ${AGENT_CHATBASE} of ${AGENT_ANSWERS} answers about agents that take actions, handle chat, email and voice, or support a Shopify store.`,
  },
  {
    q: "Does ChatGPT recommend Chatbase?",
    a: `Not in this run. ChatGPT named Chatbase in ${inEngine("openai", "Chatbase")} of its ${perEngine} answers. Asked how to build a chatbot on a website, it led with OpenAI's own tools (ChatKit, File Search) in ${CHATGPT_OPENAI_FIRST} of ${CHATGPT_CHATBOT_ANSWERS} answers.`,
  },
];

export default function SupportAgentTeardown() {
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
        <span>AI support agent teardown</span>
      </nav>

      <h1>{post.title}</h1>
      <p className="post-meta">
        AI search teardown &middot; data from {data.run.date} &middot; {post.readingTime}
      </p>

      <p className="lede">
        Chatbase started in 2023 as the easiest way to train a chatbot on your own content. Today
        it sells AI agents for customer experience, across chat, email and voice, and it publishes
        a page for AI assistants asking them not to describe it as a generic chatbot. We asked
        ChatGPT, Claude, Gemini, Perplexity and Grok {data.run.questions.length} questions a support
        team would ask, {data.run.samples} times each: {total} answers. The engines know Chatbase
        well. They mostly know the old one.
      </p>

      <h2>Three Findings, Up Front</h2>
      <ul>
        <li>
          <strong>Chatbase owns &ldquo;chatbot,&rdquo; not &ldquo;agent.&rdquo;</strong> It was named
          in {CHATBOT_CHATBASE} of {CHATBOT_ANSWERS} answers ({chatbotPct}%) to the chatbot questions,
          and {AGENT_CHATBASE} of {AGENT_ANSWERS} ({agentPct}%) to the agent questions. On agents,
          Intercom Fin was named in {AGENT_FIN} of {AGENT_ANSWERS}.
        </li>
        <li>
          <strong>ChatGPT recommends its own maker.</strong> ChatGPT named Chatbase in{" "}
          {inEngine("openai", "Chatbase")} of {perEngine} answers. Asked how to put a chatbot on a
          website, it led with OpenAI&rsquo;s ChatKit and File Search in {CHATGPT_OPENAI_FIRST} of{" "}
          {CHATGPT_CHATBOT_ANSWERS} answers.
        </li>
        <li>
          <strong>Perplexity is the exception.</strong> It named Chatbase in{" "}
          {inEngine("perplexity", "Chatbase")} of {perEngine} answers, more than any other brand, and
          chatbase.co was the most cited site in the whole run ({chatbaseSite.citations} citations
          across {chatbaseSite.answers} answers).
        </li>
      </ul>

      <ShareChart
        title={`Intercom Fin is named in ${pct("Intercom Fin")}% of AI answers about AI customer support`}
        unit={`Share of ${total} answers whose text names each platform · ${data.run.engines.length} engines · ${data.run.date}`}
        rows={data.brands}
        total={total}
        highlight="Chatbase"
      />

      <h2>Why Does Chatbase Score High on Chatbots and Low on Agents?</h2>
      <p>
        Split the questions by the job they describe and two different markets appear. On the
        chatbot questions, Chatbase is the default. On the agent questions, the engines reach for
        Intercom Fin, Zendesk, Sierra and Decagon:
      </p>
      <div className="table-scroll">
        <table className="td-table">
          <thead>
            <tr>
              <th>Questions</th>
              <th className="td-num">Chatbase</th>
              <th className="td-num">Intercom Fin</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Chatbot</strong>
                <span className="td-sub">train a chatbot on my site and docs; add a ChatGPT-style chatbot</span>
              </td>
              <td className="td-num">{CHATBOT_CHATBASE}/{CHATBOT_ANSWERS}</td>
              <td className="td-num">{CHATBOT_FIN}/{CHATBOT_ANSWERS}</td>
            </tr>
            <tr>
              <td>
                <strong>Agent</strong>
                <span className="td-sub">take actions; chat, email and voice; Shopify store</span>
              </td>
              <td className="td-num">{AGENT_CHATBASE}/{AGENT_ANSWERS}</td>
              <td className="td-num">{AGENT_FIN}/{AGENT_ANSWERS}</td>
            </tr>
            <tr>
              <td>
                <strong>Refunds and order lookups</strong>
                <span className="td-sub">the agent question alone</span>
              </td>
              <td className="td-num">{ACTIONS_CHATBASE}/{ACTIONS_ANSWERS}</td>
              <td className="td-num">{ACTIONS_FIN}/{ACTIONS_ANSWERS}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        When the engines do recommend Chatbase, they describe the product it used to lead with.
        Perplexity, asked for the best tool to train a chatbot on a website and docs:
      </p>
      <EngineQuote quote={perplexityQuote} />
      <p>
        Ask for an agent that can issue a refund and the answer changes. The engines cite
        Intercom&rsquo;s and Zendesk&rsquo;s own pages about AI agents that take actions, and name
        those vendors:
      </p>
      <EngineQuote quote={finQuote} />
      <EngineQuote quote={sierraQuote} />
      <p>
        Chatbase&rsquo;s product does take actions (its site lists order lookups, plan changes and
        cancellations). What the engines lack is pages that answer the agent questions in those
        words. That is a content gap, not a product gap, and it is the cheaper one to close.
      </p>

      <h2>ChatGPT Points to OpenAI</h2>
      <p>
        ChatGPT was the only engine that never named Chatbase. For the chatbot questions it mostly
        answered with OpenAI&rsquo;s own developer tools, citing developers.openai.com:
      </p>
      <EngineQuote quote={chatkitQuote} />
      <EngineSplit data={data} />
      <p>
        For a no-code buyer, &ldquo;use the Responses API&rdquo; is not an answer they can act on, but
        it is the one ChatGPT gives. A vendor competing for that question competes with the
        engine&rsquo;s maker. Zendesk&rsquo;s count includes a few answers that name it as an
        integration rather than a pick; most name Zendesk AI Agents directly.
      </p>

      <h2>Who Wrote the Pages the Engines Read?</h2>
      <p>
        Grounded engines search the web, then cite what they read. Chatbase&rsquo;s own site leads
        the list, which is why Perplexity, the engine that leans hardest on citations, names it
        most. The rest is vendor blogs: SiteGPT, Botpress, and support-AI startups writing
        &ldquo;best AI agent&rdquo; roundups.
      </p>
      <CitedSources data={data} limit={10} />

      <TeardownCta category="AI customer support" />

      <h2>What This Means If You&rsquo;re Repositioning</h2>
      <ul>
        <li>
          <strong>AI answers lag a rebrand.</strong> Your homepage can change in a day. The pages
          engines cite (roundups, comparisons, review sites) keep describing what you were. Measure
          the new category&rsquo;s questions separately from the old one&rsquo;s, or the old one hides
          the gap.
        </li>
        <li>
          <strong>Answer the new question in its own words.</strong> &ldquo;AI agent that can take
          actions like refunds&rdquo; is a different query from &ldquo;chatbot trained on my
          docs.&rdquo; Intercom and Zendesk have pages for exactly that query, and the engines cite
          them.
        </li>
        <li>
          <strong>Check ChatGPT on its own.</strong> A blended number hides an engine at zero. Here
          the biggest engine answers with its own maker&rsquo;s tools.
        </li>
      </ul>
      <p>
        Disclosure: openllmrank sells the kind of AI-visibility measurement used in this post.
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
