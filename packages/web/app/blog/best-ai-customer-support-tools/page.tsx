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
const SLUG = "best-ai-customer-support-tools";
const post = getPostBySlug(SLUG)!;
// Same run as /blog/ai-customer-support-agents (that post stays as published);
// this one frames it for the whole category, so the leader is the highlight.
const data = { ...raw, highlight: "Intercom Fin" } as TeardownData;

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
// Every tracked tool, split the same way (counted from the run's db with the
// same query as the constants above; each row sums to the tool's total in
// the chart). Chatbot-leaning tools first.
const SPLIT: { name: string; chatbot: number; agent: number }[] = [
  { name: "Chatbase", chatbot: CHATBOT_CHATBASE, agent: AGENT_CHATBASE },
  { name: "SiteGPT", chatbot: 16, agent: 2 },
  { name: "CustomGPT.ai", chatbot: 9, agent: 1 },
  { name: "Botpress", chatbot: 13, agent: 5 },
  { name: "Tidio", chatbot: 14, agent: 15 },
  { name: "Zendesk", chatbot: 14, agent: 28 },
  { name: "Intercom Fin", chatbot: CHATBOT_FIN, agent: AGENT_FIN },
  { name: "Sierra", chatbot: 0, agent: 11 },
  { name: "Decagon", chatbot: 0, agent: 11 },
];
const split = (name: string) => SPLIT.find((r) => r.name === name)!;

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
const leader = data.brands[0]!;
const leaderPct = pct(leader.name);
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
    q: "Which AI customer support tool do AI engines recommend most?",
    a: `Intercom Fin. It was named in ${count("Intercom Fin")} of ${total} answers (${pct("Intercom Fin")}%) across ChatGPT, Claude, Gemini, Perplexity and Grok, ahead of Zendesk (${pct("Zendesk")}%), Tidio (${pct("Tidio")}%) and Chatbase (${pct("Chatbase")}%), in a run on ${data.run.date}.`,
  },
  {
    q: "Which AI chatbot tool do AI engines recommend for training on a website?",
    a: `On the two chatbot questions (${CHATBOT_ANSWERS} answers), Chatbase was named in ${CHATBOT_CHATBASE} and SiteGPT in ${split("SiteGPT").chatbot}. Intercom Fin was named in ${CHATBOT_FIN}. On the three agent questions (${AGENT_ANSWERS} answers), the order flipped: Intercom Fin ${AGENT_FIN}, Zendesk ${split("Zendesk").agent}, Chatbase ${AGENT_CHATBASE}.`,
  },
  {
    q: "Do AI engines recommend Chatbase?",
    a: `For chatbots, yes: Chatbase was named in ${CHATBOT_CHATBASE} of ${CHATBOT_ANSWERS} answers about training a chatbot on a website or adding one to a site. For AI support agents, much less: ${AGENT_CHATBASE} of ${AGENT_ANSWERS} answers about agents that take actions, handle chat, email and voice, or support a Shopify store.`,
  },
  {
    q: "Does ChatGPT recommend its own tools for customer support chatbots?",
    a: `Often, in this run. Asked how to build a chatbot on a website, ChatGPT led with OpenAI's own tools (ChatKit, File Search) in ${CHATGPT_OPENAI_FIRST} of ${CHATGPT_CHATBOT_ANSWERS} answers. It named Chatbase in ${inEngine("openai", "Chatbase")} of its ${perEngine} answers.`,
  },
];

export default function SupportToolsTeardown() {
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
        <span>AI customer support teardown</span>
      </nav>

      <h1>{post.title}</h1>
      <p className="post-meta">
        AI search teardown &middot; data from {data.run.date} &middot; {post.readingTime}
      </p>

      <p className="lede">
        A support team shopping for AI asks two kinds of question. Some want a chatbot that answers
        from their docs. Others want an agent that can issue a refund. We asked ChatGPT, Claude,
        Gemini, Perplexity and Grok {data.run.questions.length} questions a support team would ask,{" "}
        {data.run.samples} times each: {total} answers. One tool was named in most of them. Below it,
        the engines split the market in two, and the biggest engine kept pointing at its own maker.
      </p>

      <h2>Three Findings, Up Front</h2>
      <ul>
        <li>
          <strong>Intercom Fin is the default.</strong> It was named in {count("Intercom Fin")} of{" "}
          {total} answers ({pct("Intercom Fin")}%), more than any other tool, including{" "}
          {inEngine("xai", "Intercom Fin")} of {perEngine} from Grok and{" "}
          {inEngine("google", "Intercom Fin")} of {perEngine} from Gemini.
        </li>
        <li>
          <strong>Chatbot questions and agent questions have different winners.</strong> On the
          chatbot questions ({CHATBOT_ANSWERS} answers), Chatbase ({CHATBOT_CHATBASE}) and SiteGPT (
          {split("SiteGPT").chatbot}) led. On the agent questions ({AGENT_ANSWERS} answers), Intercom
          Fin ({AGENT_FIN}) and Zendesk ({split("Zendesk").agent}) led, and Sierra and Decagon were
          named only there.
        </li>
        <li>
          <strong>ChatGPT recommends its own maker.</strong> Asked how to put a chatbot on a website,
          ChatGPT led with OpenAI&rsquo;s ChatKit and File Search in {CHATGPT_OPENAI_FIRST} of{" "}
          {CHATGPT_CHATBOT_ANSWERS} answers.
        </li>
      </ul>

      <ShareChart
        title={`${leader.name} is named in ${leaderPct}% of AI answers about AI customer support`}
        unit={`Share of ${total} answers whose text names each tool · ${data.run.engines.length} engines · ${data.run.date}`}
        rows={data.brands}
        total={total}
        highlight={data.highlight}
      />

      <h2>Is Intercom Fin the Default on Every Engine?</h2>
      <p>
        On three of five, it was named in most answers. Claude named Intercom Fin in {inEngine("anthropic", "Intercom Fin")} of{" "}
        {perEngine} answers, Gemini in {inEngine("google", "Intercom Fin")}, Grok in{" "}
        {inEngine("xai", "Intercom Fin")}. ChatGPT named it in {inEngine("openai", "Intercom Fin")}{" "}
        and Zendesk in {inEngine("openai", "Zendesk")}. Perplexity named it in{" "}
        {inEngine("perplexity", "Intercom Fin")}, and led with Chatbase instead (more on why below).
      </p>
      <EngineSplit data={data} />
      <p>
        Fin&rsquo;s lead comes from the agent questions. Ask for an agent that can issue a refund
        and the engines cite Intercom&rsquo;s and Zendesk&rsquo;s own pages about AI agents that
        take actions, and name those vendors:
      </p>
      <EngineQuote quote={finQuote} />
      <p>
        Zendesk&rsquo;s count includes a few answers that name it as an integration rather than a
        pick; most name Zendesk AI Agents directly.
      </p>

      <h2>Chatbot Questions and Agent Questions Have Different Winners</h2>
      <p>
        Split the {total} answers by the job the question describes and two markets appear. The
        chatbot questions ask to train a bot on a website and docs, or add a ChatGPT-style bot to a
        site. The agent questions ask for one that takes actions, covers chat, email and voice, or
        supports a Shopify store:
      </p>
      <div className="table-scroll">
        <table className="td-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th className="td-num">Chatbot answers</th>
              <th className="td-num">Agent answers</th>
            </tr>
          </thead>
          <tbody>
            {SPLIT.map((r) => (
              <tr key={r.name}>
                <td>
                  <strong>{r.name}</strong>
                </td>
                <td className="td-num">{r.chatbot}/{CHATBOT_ANSWERS}</td>
                <td className="td-num">{r.agent}/{AGENT_ANSWERS}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        SiteGPT was named in {split("SiteGPT").chatbot} of {CHATBOT_ANSWERS} chatbot answers and{" "}
        {split("SiteGPT").agent} of {AGENT_ANSWERS} agent answers. Sierra and Decagon were named in{" "}
        {split("Sierra").agent} agent answers each and no chatbot answers. Tidio is the one tool
        with a real presence in both ({split("Tidio").chatbot} and {split("Tidio").agent}). A vendor&rsquo;s blended share hides which of the two markets
        it is winning. Sierra, as Claude describes it:
      </p>
      <EngineQuote quote={sierraQuote} />

      <h2>ChatGPT Points to OpenAI</h2>
      <p>
        On the chatbot questions, ChatGPT mostly answered with OpenAI&rsquo;s own developer tools,
        citing developers.openai.com:
      </p>
      <EngineQuote quote={chatkitQuote} />
      <p>
        For a no-code buyer, &ldquo;use the Responses API&rdquo; is not an answer they can act on, but
        it is the one ChatGPT gave in {CHATGPT_OPENAI_FIRST} of {CHATGPT_CHATBOT_ANSWERS} chatbot
        answers. Every chatbot vendor competing for that question competes with the engine&rsquo;s
        maker.
      </p>

      <h2>The Rebrand Gap</h2>
      <p>
        Chatbase started in 2023 as the easiest way to train a chatbot on your own content. Today it
        sells AI agents for customer experience, across chat, email and voice, and it publishes a
        page for AI assistants asking them not to describe it as a generic chatbot. The engines know
        Chatbase well. They mostly know the old one:
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
        That is {chatbotPct}% of chatbot answers and {agentPct}% of agent answers. When the engines
        do recommend Chatbase, they describe the product it used to lead with. Perplexity, asked for
        the best tool to train a chatbot on a website and docs:
      </p>
      <EngineQuote quote={perplexityQuote} />
      <p>
        Perplexity named Chatbase in {inEngine("perplexity", "Chatbase")} of {perEngine} answers,
        more than any other tool, and chatbase.co was the most cited site in the whole run (
        {chatbaseSite.citations} citations across {chatbaseSite.answers} answers). ChatGPT named it
        in {inEngine("openai", "Chatbase")} of {perEngine}.
      </p>
      <p>
        Chatbase&rsquo;s product does take actions (its site lists order lookups, plan changes and
        cancellations). What the engines lack is pages that answer the agent questions in those
        words. That is a content gap, not a product gap, and it is the cheaper one to close.
      </p>
      <p>
        We went through Chatbase&rsquo;s numbers engine by engine in{" "}
        <Link href="/blog/ai-customer-support-agents">a separate teardown</Link>.
      </p>

      <h2>Who Wrote the Pages the Engines Read?</h2>
      <p>
        Grounded engines search the web, then cite what they read. Most of the top 10 is vendor
        sites: Chatbase, SiteGPT and Botpress on their own products, support-AI startups writing
        &ldquo;best AI agent&rdquo; roundups, and OpenAI&rsquo;s developer docs. Chatbase&rsquo;s own
        site leads the list, which is why Perplexity, the engine that leans hardest on citations,
        names it most.
      </p>
      <CitedSources data={data} limit={10} />

      <TeardownCta category="AI customer support" />

      <h2>What This Means If You Sell AI Customer Support</h2>
      <ul>
        <li>
          <strong>Measure each market on its own questions.</strong> In this run the chatbot
          questions and the agent questions had different leaders. A blended share can look healthy
          while one of them is near zero.
        </li>
        <li>
          <strong>Answer the question in its own words.</strong> &ldquo;AI agent that can take
          actions like refunds&rdquo; is a different query from &ldquo;chatbot trained on my
          docs.&rdquo; Intercom and Zendesk have pages for exactly that query, and the engines cite
          them.
        </li>
        <li>
          <strong>AI answers lag a rebrand.</strong> Your homepage can change in a day. The pages
          engines cite (roundups, comparisons, review sites) keep describing what you were.
        </li>
        <li>
          <strong>Check ChatGPT on its own.</strong> On chatbot questions the biggest engine
          answered with its own maker&rsquo;s tools, which a five-engine average hides.
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
