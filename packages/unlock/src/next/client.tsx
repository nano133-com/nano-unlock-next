"use client";

// The reader's side of a paid part: the Unlock button, the pay step and the wait.
//
// The page asks the site every 5 seconds if the payment arrived; the site asks the node. All times come from
// the site's clock (each answer carries it), never from this device's clock. After 15 minutes the pay step
// goes away: no amount, no QR code and no wallet button stay on a page that nobody watches. A payment still
// counts for 24 hours.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// With the ".js": see the note in index.ts.
import { useRouter } from "next/navigation.js";
import qrcode from "qrcode-generator";

type Checkout = { id: string; item: string; to: string; amount: string; xno: string; uri: string; payUntil: number; token: string };
type Answer = { state?: string; error?: string; now?: number; checkout?: Checkout | null };

type Step =
  | { name: "idle" }
  | { name: "starting" }
  | { name: "pay"; checkout: Checkout; note: string | null; pending: boolean }
  | { name: "ended"; note: string | null }
  | { name: "paid" }
  | { name: "stopped"; message: string };

const POLL_MS = 5000;
/** Each fifth question also covers the browser's older checkouts of the item: a wallet may still hold an old amount. */
const ALL_EACH = 5;
/** The "finish later" link is the page's own address, then "#nano-unlock=" and the signed checkout. */
const LINK_MARK = "#nano-unlock=";

let fromLink: string | null | undefined;
/**
 * The signed checkout of a "finish later" link, read once from the address and then taken out of it. Opening
 * such a link changes nothing by itself: the page only asks the site if THAT checkout is paid.
 */
function linkToken(): string | null {
  if (fromLink !== undefined) return fromLink;
  fromLink = null;
  if (typeof location !== "undefined" && location.hash.startsWith(LINK_MARK)) {
    const token = location.hash.slice(LINK_MARK.length);
    if (/^[A-Za-z0-9_.-]{20,1024}$/.test(token)) fromLink = token;
    history.replaceState(null, "", location.pathname + location.search);
  }
  return fromLink;
}

async function post(action: "start" | "claim", body: unknown): Promise<Answer> {
  try {
    const res = await fetch(`/api/unlock/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return ((await res.json().catch(() => null)) as Answer | null) ?? { error: "The site gave no answer. Try again." };
  } catch {
    return { error: "The site did not answer. Check your connection and try again." };
  }
}

/** The QR code of `text` as one SVG path. */
function qrPath(text: string): { path: string; size: number } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + 2},${r + 2}h1v1h-1z`;
  return { path, size: n + 4 };
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="nu-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* no clipboard: the text is on the page to select */
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

const WORDS: Record<string, string> = {
  slow: "Many readers pay right now. The check goes on: wait a moment.",
  wrong: "That block is not this payment: it has another amount or another address.",
  invalid: "That is not a block hash. A hash has 64 characters, 0 to 9 and A to F.",
  unknown: "The network does not know that block yet. Wait a moment and try again.",
  disagree: "The two nodes do not agree about this payment, so nothing is unlocked. Nothing is lost: the site owner can settle it.",
  expired: "This payment request is over. Start again.",
};

export function UnlockButton({ item, price, offer }: { item: string; price: string; offer: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "idle" });
  /** The site's clock minus this device's clock. */
  const skew = useRef(0);
  const [, setTick] = useState(0);
  /** A start that waits for a fresh page (the offer was older than 15 minutes). */
  const retry = useRef(false);
  /** The signed checkout that this page asks about: its own open one, the last one that ended, or a link's. */
  const mine = useRef<string | null>(null);
  const polls = useRef(0);
  const siteNow = () => Date.now() + skew.current;
  const learn = (a: Answer) => {
    if (typeof a.now === "number") skew.current = a.now - Date.now();
  };

  const paid = useCallback(() => {
    setStep({ name: "paid" });
    // The server renders the page again, now with the paid part.
    router.refresh();
  }, [router]);

  const start = useCallback(
    async (withOffer: string) => {
      setStep({ name: "starting" });
      const a = await post("start", { offer: withOffer });
      learn(a);
      if (a.state === "open" && a.checkout) {
        mine.current = a.checkout.token;
        return setStep({ name: "pay", checkout: a.checkout, note: null, pending: false });
      }
      if (a.state === "stale" && !retry.current) {
        retry.current = true;
        return router.refresh();
      }
      retry.current = false;
      setStep({ name: "stopped", message: a.error ?? "The payment could not start. Try again." });
    },
    [router],
  );

  // A fresh page brought a fresh offer: finish the start that waited for it.
  useEffect(() => {
    if (retry.current) {
      void start(offer).finally(() => {
        retry.current = false;
      });
    }
  }, [offer, start]);

  /**
   * One question to the site. It always carries this page's own signed checkout (`co`), so a lost or changed
   * cookie cannot hide a payment. `all` adds the browser's older checkouts of the item; `hash` is a block that
   * the reader pasted.
   */
  const check = useCallback(
    async (o: { all?: boolean; hash?: string; quiet?: boolean; link?: boolean }) => {
      const a = await post("claim", { item, co: mine.current ?? undefined, all: o.all === true, hash: o.hash });
      learn(a);
      if (a.state === "paid") return paid();
      // A link's checkout is for another item, forged or over: this paid part stays as it is.
      if (o.link && a.state === "expired") {
        mine.current = null;
        return;
      }
      const note = a.error ?? (a.state ? (WORDS[a.state] ?? null) : null);
      setStep((s) => {
        if (s.name === "pay") return { ...s, pending: a.state === "pending", note: o.quiet && !a.error ? (a.state === "disagree" ? WORDS.disagree! : null) : note };
        if (s.name === "paid") return s;
        // A page that just opened, or the ended view: show the open checkout if the browser has one.
        if (a.checkout && siteNow() < a.checkout.payUntil && !o.link) {
          mine.current = a.checkout.token;
          return { name: "pay", checkout: a.checkout, note, pending: a.state === "pending" };
        }
        // A "finish later" link never becomes a pay step: it shows only if its own checkout is paid or not.
        if (o.link) return { name: "ended", note: a.state === "pending" ? "Your payment is seen. The network confirms it now: check again in a moment." : (note ?? "No payment is seen yet for this link.") };
        if (s.name === "ended") return { name: "ended", note: note ?? (a.state === "waiting" || a.state === "none" ? "No payment is seen yet." : a.state === "pending" ? "Your payment is seen. The network confirms it now: check again in a moment." : null) };
        return s;
      });
    },
    [item, paid],
  );

  // On load: a "finish later" link's checkout, or else this browser's own checkouts of the item. (With none,
  // the site asks no node.)
  useEffect(() => {
    const token = linkToken();
    if (token) mine.current = token;
    void check({ all: !token, quiet: true, link: !!token });
  }, [check]);

  // The pay step: ask every 5 seconds, count down, and end after the 15 minutes.
  const open = step.name === "pay" ? step.checkout : null;
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      if (siteNow() >= open.payUntil) return setStep({ name: "ended", note: null });
      setTick((t) => t + 1);
      if (document.visibilityState === "visible") void check({ all: ++polls.current % ALL_EACH === 0, quiet: true });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [open, check]);

  const qr = useMemo(() => (open ? qrPath(open.uri) : null), [open]);
  const [hash, setHash] = useState("");

  if (step.name === "paid") return <p className="nu-ok">Paid. Thank you. The page opens now…</p>;

  if (step.name === "pay" && open && qr) {
    const left = Math.max(0, Math.ceil((open.payUntil - siteNow()) / 60_000));
    const finish = typeof location === "undefined" ? "" : `${location.origin}${location.pathname}${location.search}${LINK_MARK}${open.token}`;
    return (
      <div className="nu-pay">
        <p className="nu-lead">Pay with a Nano wallet. Scan the code, or open your wallet on this device.</p>
        <svg className="nu-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="QR code of the payment">
          <rect width={qr.size} height={qr.size} fill="#fff" />
          <path d={qr.path} fill="#000" />
        </svg>
        <a className="nu-button" href={open.uri}>
          Open in wallet
        </a>
        <dl className="nu-facts">
          <div>
            <dt>Amount (send exactly this)</dt>
            <dd>
              <code>Ӿ{open.xno}</code>
              <Copy text={open.xno} label="Copy" />
            </dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>
              <code>{open.to}</code>
              <Copy text={open.to} label="Copy" />
            </dd>
          </div>
        </dl>
        <p className="nu-small">The code and the wallet button fill in the exact amount. A typed amount or an exchange cannot send it: use a wallet.</p>
        <p className="nu-wait" role="status">
          {step.pending ? "Your payment is seen. The network confirms it now…" : `Waiting for your payment… (${left} min left on this page)`}
        </p>
        {step.note && (
          <p className="nu-error" role="alert">
            {step.note}
          </p>
        )}
        <details className="nu-more">
          <summary>Paid, and nothing happens?</summary>
          <p>A payment counts for 24 hours. Paste the payment&apos;s block hash from your wallet:</p>
          <div className="nu-row">
            <input className="nu-input" value={hash} onChange={(e) => setHash(e.target.value)} placeholder="64 characters" aria-label="Block hash" autoComplete="off" spellCheck={false} />
            <button type="button" className="nu-copy" onClick={() => void check({ hash })}>
              Check
            </button>
          </div>
          <p>Or keep this link to finish later, on this device or another:</p>
          <div className="nu-row">
            <Copy text={finish} label="Copy the finish-later link" />
          </div>
        </details>
      </div>
    );
  }

  if (step.name === "ended") {
    return (
      <div className="nu-act">
        <p className="nu-lead">The 15 minutes of this payment request are over. If you paid, your payment still counts for 24 hours.</p>
        <button type="button" className="nu-button nu-quiet" onClick={() => void check({ all: true })}>
          I paid: check again
        </button>
        <button type="button" className="nu-button" onClick={() => void start(offer)}>
          Start again
        </button>
        {mine.current && (
          <details className="nu-more">
            <summary>Paste the payment&apos;s block hash</summary>
            <div className="nu-row">
              <input className="nu-input" value={hash} onChange={(e) => setHash(e.target.value)} placeholder="64 characters" aria-label="Block hash" autoComplete="off" spellCheck={false} />
              <button type="button" className="nu-copy" onClick={() => void check({ hash })}>
                Check
              </button>
            </div>
          </details>
        )}
        {step.note && (
          <p className="nu-error" role="status">
            {step.note}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="nu-act">
      <button type="button" className="nu-button" onClick={() => void start(offer)} disabled={step.name === "starting"}>
        {step.name === "starting" ? "Starting…" : `Unlock for ${price}`}
      </button>
      {step.name === "stopped" && (
        <p className="nu-error" role="alert">
          {step.message}
        </p>
      )}
    </div>
  );
}
