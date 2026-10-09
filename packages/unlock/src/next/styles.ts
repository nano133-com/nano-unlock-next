// The paid part's own styles, so a site needs no stylesheet import. Phone first. A site changes the look with
// the custom properties on `.nu`.

export const STYLES = `
.nu{--nu-ink:#1d2327;--nu-soft:#50575e;--nu-line:#dcdcde;--nu-paper:#f6f7f7;--nu-accent:#1f6feb;--nu-on-accent:#fff;--nu-warn:#8a4b00;--nu-warn-paper:#fff8e5;--nu-ok:#0a6b2d;
margin:2rem 0;padding:1.25rem;border:1px solid var(--nu-line);border-radius:12px;background:var(--nu-paper);color:var(--nu-ink);font:inherit;text-align:center}
.nu *{box-sizing:border-box}
.nu-kicker{margin:0;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--nu-soft)}
.nu-title{margin:.25rem 0 1rem;font-size:1.25rem;line-height:1.3}
.nu-act,.nu-pay{display:grid;gap:.75rem;justify-items:center}
.nu-button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;width:100%;max-width:22rem;padding:.75rem 1.25rem;border:0;border-radius:999px;background:var(--nu-accent);color:var(--nu-on-accent);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.nu-button.nu-quiet{background:transparent;color:var(--nu-accent);box-shadow:inset 0 0 0 2px var(--nu-accent)}
.nu-button:disabled{opacity:.6;cursor:default}
.nu-button:focus-visible,.nu-copy:focus-visible,.nu-input:focus-visible{outline:3px solid var(--nu-ink);outline-offset:2px}
.nu-lead{margin:0;max-width:28rem}
.nu-qr{width:min(15rem,70vw);height:auto;border:1px solid var(--nu-line);border-radius:8px;background:#fff}
.nu-facts{display:grid;gap:.75rem;width:100%;max-width:28rem;margin:0;text-align:left}
.nu-facts dt{font-size:.8125rem;color:var(--nu-soft)}
.nu-facts dd{display:flex;align-items:flex-start;gap:.5rem;margin:.125rem 0 0}
.nu-facts code{flex:1;min-width:0;padding:.5rem .625rem;border:1px solid var(--nu-line);border-radius:8px;background:#fff;font-size:.8125rem;line-height:1.45;overflow-wrap:anywhere;user-select:all}
.nu-copy{flex:none;min-height:44px;padding:.5rem .875rem;border:1px solid var(--nu-line);border-radius:8px;background:#fff;color:var(--nu-ink);font:inherit;font-size:.875rem;font-weight:600;cursor:pointer}
.nu-small,.nu-foot{margin:0;font-size:.8125rem;color:var(--nu-soft);max-width:28rem}
.nu-foot{margin:1rem auto 0}
.nu-wait{margin:0;font-weight:600}
.nu-ok{margin:0;font-weight:600;color:var(--nu-ok)}
.nu-note,.nu-error{display:grid;gap:.25rem;margin:0 auto;max-width:28rem;padding:.75rem 1rem;border-radius:8px;background:var(--nu-warn-paper);color:var(--nu-warn);font-size:.9375rem;text-align:left}
.nu-more{width:100%;max-width:28rem;text-align:left;font-size:.9375rem}
.nu-more summary{min-height:44px;display:flex;align-items:center;cursor:pointer;color:var(--nu-accent);font-weight:600}
.nu-more p{margin:.5rem 0}
.nu-row{display:flex;gap:.5rem}
.nu-input{flex:1;min-width:0;min-height:44px;padding:.5rem .625rem;border:1px solid var(--nu-line);border-radius:8px;background:#fff;color:var(--nu-ink);font:inherit;font-size:.875rem}
@media (min-width:720px){.nu{padding:2rem}}
`;
