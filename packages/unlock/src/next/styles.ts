// The paid part's own styles, so a site needs no stylesheet import. Phone first. A site changes the look with
// the custom properties on `.nu`.

export const STYLES = `
.nu{--nu-ink:#1d2327;--nu-soft:#50575e;--nu-line:#dcdcde;--nu-paper:#f6f7f7;--nu-accent:#1f6feb;--nu-on-accent:#fff;--nu-warn:#8a4b00;--nu-warn-paper:#fff8e5;
margin:2rem 0;padding:1.25rem;border:1px solid var(--nu-line);border-radius:12px;background:var(--nu-paper);color:var(--nu-ink);font:inherit;text-align:center}
.nu-kicker{margin:0;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--nu-soft)}
.nu-title{margin:.25rem 0 1rem;font-size:1.25rem;line-height:1.3}
.nu-act{display:grid;gap:.75rem;justify-items:center}
.nu-button{min-height:48px;width:100%;max-width:22rem;padding:.75rem 1.25rem;border:0;border-radius:999px;background:var(--nu-accent);color:var(--nu-on-accent);font:inherit;font-weight:600;cursor:pointer}
.nu-button:disabled{opacity:.6;cursor:default}
.nu-button:focus-visible{outline:3px solid var(--nu-ink);outline-offset:2px}
.nu-note,.nu-error{display:grid;gap:.25rem;margin:0 auto;max-width:28rem;padding:.75rem 1rem;border-radius:8px;background:var(--nu-warn-paper);color:var(--nu-warn);font-size:.9375rem;text-align:left}
.nu-foot{margin:1rem 0 0;font-size:.8125rem;color:var(--nu-soft)}
@media (min-width:720px){.nu{padding:2rem}}
`;
