"use client";

// The reader's side of a paid part: the Unlock button and what comes after it.
//
// HOLD (PLAN.md 2a): the pay step (the amount, the QR code, the wallet link, the wait) belongs to the checkout,
// a money rule that waits for its "go". This shell asks the route to start, and says what the route answers.

import { useState } from "react";

type Step = { name: "idle" } | { name: "starting" } | { name: "stopped"; message: string };

export function UnlockButton({ item, price }: { item: string; price: string }) {
  const [step, setStep] = useState<Step>({ name: "idle" });

  async function start() {
    setStep({ name: "starting" });
    try {
      const res = await fetch("/api/unlock/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStep({ name: "stopped", message: body.error ?? "The payment could not start. Try again." });
    } catch {
      setStep({ name: "stopped", message: "The site did not answer. Check your connection and try again." });
    }
  }

  return (
    <div className="nu-act">
      <button type="button" className="nu-button" onClick={start} disabled={step.name === "starting"}>
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
