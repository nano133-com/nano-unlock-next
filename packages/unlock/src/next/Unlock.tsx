// <Unlock item="post-1" price={0.01} />: what a reader sees in place of a paid part. A server component: it
// reads the owner's settings and signs the offer (this item, at this price). With a setting absent or wrong
// it shows a notice and NO way to pay.

import { makeOffer } from "../checkout.ts";
import { readConfig } from "../config.ts";
import { isItem } from "../pass.ts";
import { UnlockButton } from "./client.tsx";
import { STYLES } from "./styles.ts";

export type UnlockProps = {
  /** The item's name: the same text as in `unlocked(item)`. */
  item: string;
  /** The price in US dollars, from 0.01 to 1000. */
  price: number;
  /** What the reader gets, in a few words. */
  title?: string;
};

const usd = (price: number) => (price < 1 ? `${Math.round(price * 100)}¢` : `$${price.toFixed(2).replace(/\.00$/, "")}`);

export async function Unlock({ item, price, title = "The rest of this article" }: UnlockProps) {
  const config = readConfig(process.env);
  const sound = isItem(item) && Number.isFinite(price) && price >= 0.01 && price <= 1000;
  const offer = config.ok && sound ? await makeOffer(config.settings.secret, { item, usd: price }) : null;
  return (
    <section className="nu" aria-label="Paid part">
      {/* React 19 lifts this to the head once, however many paid parts a page has. */}
      <style href="nano-unlock" precedence="default">
        {STYLES}
      </style>
      <p className="nu-kicker">Paid part</p>
      <h2 className="nu-title">{title}</h2>
      {offer === null ? (
        <div className="nu-note" role="status">
          <b>This part cannot be unlocked yet.</b>
          <span>{!config.ok ? "The site owner has a setting to finish. No payment is possible until then." : "This paid part has a wrong name or price."}</span>
        </div>
      ) : (
        <UnlockButton item={item} price={usd(price)} offer={offer} />
      )}
      <p className="nu-foot">Paid with Nano (XNO). No account, no card. The payment goes straight to the writer.</p>
    </section>
  );
}
