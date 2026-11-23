import { permanentRedirect } from "next/navigation";

// /vs on its own has nothing to show; the hub lives at /alternatives.
export default function VsIndex() {
  permanentRedirect("/alternatives");
}
