// The page that a site shows while a setting is absent or wrong. Nothing else is served until it is fixed:
// no article, no price and no way to pay. It names the settings and never shows a value.

import type { Problem } from "@nano133/unlock/next";

const HELP: Record<Problem["setting"], string> = {
  NANO_ADDRESS: "Your own Nano address, from your wallet's Receive screen. Readers pay this address. The site never holds its key.",
  UNLOCK_SECRET: "A long random text that only this site knows. It signs the readers' passes. Make one with: openssl rand -base64 48",
  NANO_NODE_URL: "Optional. The Nano node that proves the payments. Leave it out to use the default public node.",
  NANO_NODE_URL_2: "Optional. A second node. With it, a payment counts only when both nodes confirm it.",
};

export function Setup({ problems }: { problems: Problem[] }) {
  return (
    <main className="setup">
      <p className="setup-kicker">Setup</p>
      <h1>This site is not ready yet</h1>
      <p>
        {problems.length === 1 ? "One setting needs" : `${problems.length} settings need`} your attention. Until then the site shows no article and takes no
        payment.
      </p>
      <ol className="setup-list">
        {problems.map((p) => (
          <li key={p.setting}>
            <code>{p.setting}</code>
            <b>{p.message}</b>
            <span>{HELP[p.setting]}</span>
          </li>
        ))}
      </ol>
      <h2>Where to set them</h2>
      <ul>
        <li>
          <b>On Vercel:</b> Project → Settings → Environment Variables. Add the settings, then redeploy.
        </li>
        <li>
          <b>On your computer:</b> copy <code>.env.example</code> to <code>.env.local</code>, fill it in, and start the site again.
        </li>
      </ul>
      <p className="setup-foot">Only the owner of the site needs this page. A visitor can come back later.</p>
    </main>
  );
}
