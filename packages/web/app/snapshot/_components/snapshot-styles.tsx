// Scoped styles for /snapshot. Tokens only (DESIGN.md): warm paper, hairline
// rules, moss accent for "you", terra-cotta for emphasis. No colored
// left-border cards, no gradients.

export function SnapshotStyles() {
  return (
    <style>{`
      .snapshot-form .field { margin-bottom: var(--space-md); }
      .snapshot-hint { display: block; font-size: 14px; margin-top: var(--space-xs); }
      .snapshot-legal { font-size: 13px; margin-top: var(--space-sm); }
      .snapshot-legal a { color: var(--muted); }

      .snapshot-progress {
        display: flex; align-items: center; gap: var(--space-sm);
        font-weight: 600; color: var(--ink); margin: var(--space-lg) 0;
      }
      .snapshot-dot {
        width: 10px; height: 10px; border-radius: var(--radius-pill);
        background: var(--accent); animation: snapshot-pulse 1.4s ease-in-out infinite;
      }
      .snapshot-elapsed { color: var(--muted); font-weight: 400; font-variant-numeric: tabular-nums; }
      @keyframes snapshot-pulse { 50% { opacity: 0.3; } }
      @media (prefers-reduced-motion: reduce) { .snapshot-dot { animation: none; } }
      .snapshot-questions { padding-left: 1.2em; line-height: 1.6; }
      .snapshot-questions li { margin-bottom: var(--space-sm); }

      .snapshot-result h1 { max-width: 760px; }
      .snapshot-card {
        border-top: 1px solid var(--line);
        padding-top: var(--space-md); margin-top: var(--space-xl);
      }
      .wrap .snapshot-card h2 { margin-top: 0; }
      .snapshot-note { font-size: 14px; }

      .snapshot-board { list-style: none; padding: 0; margin: var(--space-md) 0 0; }
      .snapshot-board li {
        display: grid; grid-template-columns: minmax(96px, 200px) 1fr auto;
        align-items: center; gap: var(--space-md);
        padding: var(--space-sm) 0; border-bottom: 1px solid var(--line);
      }
      .board-name { font-weight: 600; overflow-wrap: anywhere; }
      .board-bar { height: 10px; background: var(--soft); border-radius: var(--radius-pill); overflow: hidden; }
      .board-bar span { display: block; height: 100%; background: var(--muted); border-radius: var(--radius-pill); min-width: 2px; }
      .snapshot-board li.is-you .board-name { color: var(--accent); }
      .snapshot-board li.is-you .board-bar span { background: var(--accent); }
      .board-count { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 14px; }

      .snapshot-engines { list-style: none; padding: 0; margin: 0; }
      .snapshot-engines li {
        display: flex; justify-content: space-between; gap: var(--space-md);
        padding: var(--space-sm) 0; border-bottom: 1px solid var(--line);
        font-size: 15px;
      }
      .snapshot-engines li > span:last-child { text-align: right; overflow-wrap: anywhere; }
      .engine-yes { color: var(--accent); font-weight: 600; }
      .engine-no { color: var(--accent-2); }

      .snapshot-question { margin-top: var(--space-lg); }
      .question-text { font-family: var(--font-display); font-size: 19px; margin: 0 0 var(--space-sm); }

      .snapshot-locked {
        position: relative; border: 1px solid var(--line);
        border-radius: var(--radius-md); overflow: hidden; margin-top: var(--space-sm);
      }
      .locked-fake { padding: var(--space-md); filter: blur(4px); opacity: 0.7; user-select: none; }
      .locked-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--line); }
      .locked-row span { height: 10px; background: var(--line); border-radius: var(--radius-pill); }
      .locked-over {
        position: absolute; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: var(--space-xs);
        text-align: center; padding: var(--space-md);
      }
      .locked-label {
        display: inline-flex; align-items: center; gap: var(--space-sm);
        background: var(--paper); border: 1px solid var(--line);
        border-radius: var(--radius-pill); padding: var(--space-xs) var(--space-md);
        font-weight: 600; font-size: 14px;
      }
      .locked-link { font-size: 14px; color: var(--accent); }

      .snapshot-cta {
        margin-top: var(--space-xxl); padding: var(--space-lg);
        background: var(--soft); border: 1px solid var(--line); border-radius: var(--radius-md);
      }
      .wrap .snapshot-cta h2 { margin-top: 0; }
      .snapshot-cta ul { padding-left: 1.2em; line-height: 1.7; margin-bottom: var(--space-lg); }
      .snapshot-cta .snapshot-note { margin-top: var(--space-md); }

      @media (max-width: 640px) {
        .snapshot-board li { grid-template-columns: 1fr auto; }
        .board-bar { grid-column: 1 / -1; grid-row: 2; }
        .snapshot-engines li { flex-direction: column; gap: 2px; }
        .snapshot-engines li > span:last-child { text-align: left; }
        .snapshot-cta { padding: var(--space-md); }
      }
    `}</style>
  );
}
