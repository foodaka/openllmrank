/** Shared citation mark and live-text wordmark; the surrounding link owns navigation. */
export function BrandLogo() {
  return (
    <span className="brand-logo">
      <img className="brand-logo-mark" src="/brand/citation.svg" width="28" height="28" alt="" aria-hidden="true" />
      <span>openllmrank</span>
    </span>
  );
}
