import { SnapshotForm } from "./_components/snapshot-form";
import { SnapshotStyles } from "./_components/snapshot-styles";

const TITLE = "Free AI Visibility Checker: Does ChatGPT Recommend You?";
const DESCRIPTION =
  "See how often ChatGPT, Claude, Gemini, Perplexity and Grok mention your brand vs. your competitors. Free snapshot from your website in a few minutes. No card.";

export const metadata = {
  title: { absolute: `${TITLE} | OpenLLMRank` },
  description: DESCRIPTION,
  alternates: { canonical: "/snapshot" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "https://openllmrank.io/snapshot" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function SnapshotLandingPage() {
  return (
    <article className="wrap check-hero">
      <span className="kicker">Free AI visibility snapshot</span>
      <h1>Does AI recommend you, or your competitors?</h1>
      <p className="sub">
        Give us your website. We draft the questions your buyers ask, put them
        to ChatGPT, Claude, Gemini, Perplexity and Grok, and show you who
        each one recommends. Real answers, in a few minutes. No card.
      </p>

      <SnapshotForm />

      <hr className="rule" />

      <section className="check-explain">
        <h2>What you get</h2>
        <ul>
          <li>
            <strong>Your mention rate vs. competitors</strong> &mdash; how
            many of the AI answers named you, and how many named the brands
            you compete with.
          </li>
          <li>
            <strong>Engine by engine</strong> &mdash; which of the five
            engines know you, and which ones leave you out.
          </li>
          <li>
            <strong>The questions we asked</strong> &mdash; three buyer
            questions drafted from your own site, so the result reflects your
            category, not a generic keyword list.
          </li>
        </ul>
        <p className="muted">
          A snapshot is one sample per engine. To see every answer, the
          sources AI cites, and how it moves week to week,{" "}
          <a href="/wizard/brand">track your brand for $49/month</a>.
        </p>
      </section>
      <SnapshotStyles />
    </article>
  );
}
