import data from "../../../content/teardowns/ai-customer-support-agents.json";
import { sharePct, type TeardownData } from "../../../lib/teardown";
import { teardownOgImage, teardownOgSize } from "../_components/teardown-og";

export const runtime = "edge";
export const alt = "Share of 75 AI answers naming each AI customer support tool, across five AI engines";
export const size = teardownOgSize;
export const contentType = "image/png";

export default function Image() {
  const d = data as TeardownData;
  const leader = d.brands[0]!;
  return teardownOgImage({
    data: d,
    kicker: "AI search teardown",
    headline: `Which AI support tool do AI engines recommend? ${leader.name}: ${sharePct(leader.answers, d.run.answers)}% of answers.`,
  });
}
