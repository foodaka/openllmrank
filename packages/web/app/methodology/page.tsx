import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AI Visibility Benchmark Methodology & Limitations",
  description: "How openllmrank measures brand mentions and citations, what API benchmarks can tell you, and the scope of our July 2026 research.",
  alternates: { canonical: "/methodology" },
};

export default function MethodologyPage() {
  return <article className="post">
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/">Home</Link> / Methodology</nav>
    <h1>How we measure AI search visibility</h1>
    <p className="post-meta">Published by openllmrank · September 23, 2026</p>
    <p className="lede">A visibility benchmark is a sample of answers to a defined set of questions. It can show where your brand appears, which competitors appear alongside it, and which sources an API returns. It cannot predict every answer a buyer will see.</p>
    <h2>What the hosted product measures</h2>
    <p>We run your questions three times across five grounded provider APIs: OpenAI, Anthropic, Google Gemini, Perplexity, and xAI. Grounded means web search is enabled. Keep the questions and competitors stable when comparing runs, and inspect the report’s provider and model details.</p>
    <p>A brand mention in answer text and a cited source URL are distinct observations. Inspect the captured answer and source evidence rather than treating a single score as proof of a recommendation. A provider failure is not evidence that a brand is absent.</p>
    <h2>API answers are not consumer-app measurements</h2>
    <p>Consumer products can use different models, search tools, location, personalization, and conversation history. Our provider API benchmarks do not directly measure Google AI Overviews, Google AI Mode, or the exact ChatGPT screen a customer sees.</p>
    <h2>The July 2026 published study</h2>
    <p>The <Link href="/blog/state-of-ai-search-2026">original study</Link> reports 10 software buying questions × five providers × three repeated samples = 150 answers. The <Link href="/blog/which-sources-do-ai-engines-cite">source analysis</Link> reports that 149 answers returned web sources.</p>
    <p>The published methodology names OpenAI gpt-5.4-mini, Anthropic claude-haiku-4-5, Google gemini-3.5-flash, Perplexity sonar, and xAI grok-4.3. These are the versions reported in the July article, not a statement of the current product’s model lineup.</p>
    <ul>
      <li>Brand counts use names and known aliases in answer text. Matching can miss indirect references or count ambiguous ones.</li>
      <li>Publisher counts deduplicate domains within each answer. G2 combines g2.com and learn.g2.com. Counts across publishers can exceed 150 because one answer can contain multiple sources.</li>
      <li>The published table excludes Gemini’s vertexaisearch.cloud.google.com redirect wrapper. This may underrepresent publishers behind unresolved redirects; provider comparisons need resolved URLs.</li>
      <li>Ten software questions are a narrow convenience sample. Three repeats per provider do not support precise population estimates or causal claims about ranking factors.</li>
    </ul>
    <h2>Download the published aggregates</h2>
    <ul>
      <li><a href="/research/july-2026-published-prompts.csv" download>Ten published buying questions (CSV)</a></li>
      <li><a href="/research/july-2026-published-source-counts.csv" download>Published publisher counts (CSV)</a></li>
    </ul>
    <p>These downloads transcribe the existing articles. The public evidence does not include raw answers, exact collection timestamps, full request configuration, or provider-level source counts. Consequently, the historical counts cannot be independently reconstructed from these files alone. We have not filled those gaps with generated data.</p>
    <h2>How to run a useful comparison</h2>
    <ol>
      <li>Record the questions, competitor aliases, models, web-search settings, and run dates.</li>
      <li>Retain original answers, cited URLs, errors, and successful-response denominators.</li>
      <li>Inspect ambiguous mentions and resolve source redirects before aggregating publishers.</li>
      <li>Repeat the same question set after a documented change. Model and retrieval changes can also affect the results.</li>
      <li>Measure qualified visits and purchases separately: more AI mentions do not automatically mean more customers.</li>
    </ol>
    <p>The <a href="https://github.com/foodaka/openllmrank">open-source CLI</a> exposes the implementation for inspection. Our comparison articles disclose that we build one of the products; competitor claims link to vendor documentation and are not presented as independent hands-on tests.</p>
    <div className="post-cta"><h2>Inspect the output before you buy</h2><p>The sample report uses illustrative data and shows the report format.</p><Link className="btn-primary" href="/sample-report.html">View a sample report</Link>{" "}<Link href="/wizard/brand">Start tracking — $49/month</Link></div>
  </article>;
}
