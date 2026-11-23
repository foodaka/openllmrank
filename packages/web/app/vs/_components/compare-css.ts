// Styles shared by /vs/[slug] and /alternatives. Inlined per page (like the
// blog's comparison table) so the global stylesheet stays untouched.
export const COMPARE_CSS = `
  .post .compare-table { min-width: 640px; }
  .post .compare-table th[scope="row"] { text-transform: none; letter-spacing: normal; font-size: 15px; font-weight: 600; color: var(--ink); width: 22%; }
  .post .compare-table td { width: 39%; }
  .post .compare-table td.us { background: var(--soft); padding-left: 12px; }
  .post .compare-table thead th.us { padding-left: 12px; }
  .post .hub-table th[scope="row"] { width: 16%; }
  .post .hub-table td { width: auto; }
  .post .hub-table td:last-child { width: 20%; }
  .post .compare-table caption { text-align: left; margin-bottom: 16px; font-size: 14px; color: var(--muted); }
  .post .table-scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
  .post .pick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 0 0 24px; }
  .post .pick-grid section { border-top: 2px solid var(--ink); padding-top: 4px; }
  .post .pick-grid h3 { margin-top: 12px; }
  .post .pick-grid ul { font-size: 16px; }
  .post .facts li { font-size: 16px; }
  .post .facts a { font-size: 14px; color: var(--muted); }
  .post .verdict { border-left: 2px solid var(--accent-2); padding-left: 20px; }
  .post .alt-list { list-style: none; padding: 0; }
  .post .alt-list li { padding: 20px 0; border-top: 1px solid var(--line); margin: 0; }
  .post .alt-list h3 { margin: 0 0 6px; }
  .post .alt-list h3 a { color: var(--ink); border-bottom: none; }
  .post .alt-list h3 a:hover { color: var(--accent); }
  .post .alt-list p { margin: 0; color: var(--muted); font-size: 16px; }
  @media (max-width: 820px) {
    .post .pick-grid { grid-template-columns: 1fr; }
  }
`;
