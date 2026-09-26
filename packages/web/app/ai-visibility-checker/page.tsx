import { MentionForm } from "./_components/mention-form";

const TITLE = "Free AI Visibility Checker: Does ChatGPT Mention Your Brand?";
const DESCRIPTION =
  "Ask ChatGPT, Perplexity and Gemini a real buyer question and see whether they mention your brand, who they name instead, and which sources they cite. Free, no signup.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/ai-visibility-checker" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "https://openllmrank.io/ai-visibility-checker" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function AiVisibilityCheckerPage() {
  return (
    <article className="wrap check-hero">
      <span className="kicker">Free AI visibility check</span>
      <h1>Does AI recommend your brand?</h1>
      <p className="sub">
        Buyers now ask ChatGPT, Perplexity and Gemini what to buy. Type one
        question your buyers ask, and we&rsquo;ll put it to all three with web
        search on, then show you whether they mention you, what they say
        instead, and which pages they cite.
      </p>

      <MentionForm />

      <hr className="rule" />

      <section className="check-explain">
        <h2>How it works</h2>
        <ul>
          <li>
            <strong>Real grounded answers</strong> &mdash; we ask each
            assistant through its API with web search enabled, the same way our
            paid reports do. No scraping, no simulated answers.
          </li>
          <li>
            <strong>Mentions and sources</strong> &mdash; we look for your brand
            name and your domain in the answer and in the pages it cites, and
            show you the exact passage.
          </li>
          <li>
            <strong>One question, one answer each</strong> &mdash; AI answers
            vary between runs, so treat this as a first signal. The{" "}
            <a href="/sample-report.html">full report</a> asks up to 10
            questions three times on five assistants and compares you against
            your competitors.
          </li>
        </ul>
        <p className="muted">
          Not mentioned anywhere? Check first that AI crawlers can reach your
          site with the <a href="/check">free crawlability check</a>.
        </p>
      </section>
    </article>
  );
}
