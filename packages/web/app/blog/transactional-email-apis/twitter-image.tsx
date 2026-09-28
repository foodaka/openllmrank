import data from "../../../content/teardowns/transactional-email-apis.json";
import type { TeardownData } from "../../../lib/teardown";
import { teardownOgImage, teardownOgSize } from "../_components/teardown-og";

export const runtime = "edge";
export const alt = "Share of 60 AI answers naming each email API, across five AI engines";
export const size = teardownOgSize;
export const contentType = "image/png";

export default function Image() {
  return teardownOgImage({
    data: data as TeardownData,
    kicker: "AI search teardown",
    headline: "Which email API do AI engines tell builders to use?",
  });
}
