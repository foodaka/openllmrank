import data from "../../../content/teardowns/ai-customer-support-agents.json";
import type { TeardownData } from "../../../lib/teardown";
import { teardownOgImage, teardownOgSize } from "../_components/teardown-og";

export const runtime = "edge";
export const alt = "Share of 75 AI answers naming each AI customer support platform, across five AI engines";
export const size = teardownOgSize;
export const contentType = "image/png";

export default function Image() {
  return teardownOgImage({
    data: data as TeardownData,
    kicker: "AI search teardown",
    headline: "Chatbase rebranded to AI agents. AI search still calls it a chatbot.",
  });
}
