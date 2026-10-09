# @nano133/unlock

**Nano Unlock for Next.js.** Sell part of a page for a few cents in Nano (XNO). The reader pays **your own
Nano address** directly, and **your site** checks the payment at a Nano node. No account, no card, no service
in between. The package never holds a key or any money, and it needs no database.

- Next.js 15 or 16 (App Router), React 19, Node.js 20.9 or newer.
- Runs on Vercel, on your own Node.js server, and on Cloudflare Workers with the OpenNext adapter (0.1.1 or
  newer; the repository's README has the Cloudflare steps and limits).
- A ready blog with a "Deploy to Vercel" button: <https://github.com/nano133-com/nano-unlock-next>

## 5 minutes to a paid article

1. Install the package.

   ```sh
   npm install @nano133/unlock
   ```

2. Make the file `app/api/unlock/[action]/route.ts`:

   ```ts
   import { handlers } from "@nano133/unlock/next";

   export const { GET, POST } = handlers();
   ```

3. Set two settings in your host's environment variables (see below): `NANO_ADDRESS` and `UNLOCK_SECRET`.

4. In the page of an article (a server component):

   ```tsx
   import { Unlock, unlocked } from "@nano133/unlock/next";

   export default async function Page() {
     return (
       <article>
         <p>The free part.</p>
         {(await unlocked("post-1")) ? <PaidPart /> : <Unlock item="post-1" price={0.01} />}
       </article>
     );
   }
   ```

5. Deploy. Open the article, press Unlock, pay from a Nano wallet, read.

`item` is a name of your choice (letters, digits, `.` `_` `:` `-`, 80 at most). `price` is in US dollars,
0.01 to 1000. The paid part is rendered on the server only, for a reader who holds a pass. `unlocked` reads the
request's cookies, so Next.js renders the page for each request and stores no reader's page for another.

## Settings

| Setting | Needed | What it is |
|---|---|---|
| `NANO_ADDRESS` | Yes | Your own Nano address, from your wallet's Receive screen. Readers pay this address. A typed error is refused (the address has a checksum). |
| `UNLOCK_SECRET` | Yes | A long random text that only your site knows (32 characters or more). It signs the readers' passes. Make one with `openssl rand -base64 48`. |
| `NANO_NODE_URL` | No | The Nano node that proves the payments. Default: `https://node.nano133.com/rpc`. Use your own node if you have one: its answers decide what your site unlocks. |
| `NANO_NODE_URL_2` | No | A second, different node. With it, a payment counts only when both nodes confirm the same send. |
| `UNLOCK_CLAIMS_PER_MINUTE` | No | How many times a minute one running instance may ask the node about a checkout. Default: 50 (2 node calls each; the default node allows about 120 calls a minute for one address). |

There is no default address. With a setting absent or wrong, `<Unlock>` shows a notice in place of the button,
and the route starts no payment. A node on plain `http`, on `localhost` or on a private network is refused: it
cannot see a real payment.

## How it works

1. The page carries a signed offer: the item and its price. The reader cannot change the price.
2. A checkout asks an exact amount: the price in XNO (rounded up to Ӿ0.0001) plus a random tail below 10^20
   raw (at most Ӿ0.0000000001). The amount tells this payment from every other, so one address serves every
   reader with no memo. The checkout is a signed text in an httpOnly cookie.
3. The reader pays with the QR code or the "Open in wallet" link, which fill in the exact amount. **A typed
   amount or an exchange's withdrawal cannot send it.**
4. The page asks your site every 5 seconds; your site asks the node. A payment unlocks only when the node says
   that the block is a **confirmed send** of **exactly** that amount **to your address**, first seen after the
   checkout's start. When a node does not answer, nothing is unlocked.
5. The reader's browser gets a pass: a signed, httpOnly cookie for that item, for 30 days.

The pay step is shown for 15 minutes. A payment counts for 24 hours from the checkout's start. The pay step
offers a "finish later" link and a field for the payment's block hash.

## Limits to know

- **No list of sales.** The site stores nothing. Your wallet's history is the record of who paid what.
- **No true rate limit.** A serverless site has many instances and no shared count, so the package's own
  limits are best-effort. Use your host's rate limit for `/api/unlock/*` if you need a true one.
- **A payment with no unlock is settled by hand.** It can happen: a payment later than 24 hours, a wrong
  amount, a page closed with no finish-later link in a browser that lost its cookies, or more than 50 payments
  to your address inside one checkout's time. The package holds no key, so it cannot send money back. You see
  every payment in your wallet: return it or give access from there.
- **A pass is a cookie of one browser.** A person who copies it has the same access until it ends. The same is
  true for a copied checkout or finish-later link together with its payment. There is no pass link for a
  second device in this version.
- **The finish-later link opens the paid part for anyone who has it,** once its payment is on the network,
  for the 24 hours of its checkout. It is the page's address with the signed checkout after the `#`: it is
  not sent to a server and is in no referrer, but a script on your page can read it. Keep it like a ticket.
- **Only a new `UNLOCK_SECRET` ends a pass early,** and it ends every pass.
- Nobody can stop a reader from copying text that they unlocked.

## The core, with no framework

`@nano133/unlock` (the main entry) has the parts with no Next.js in them: `startCheckout`, `claimCheckout`,
`makePass`, `hasPass`, `checkPayment`, `readConfig` and the amount and address tools. The route handlers in
`@nano133/unlock/next` are plain `Request` to `Response` functions built from them.

## Licence

MIT. Source and issues: <https://github.com/nano133-com/nano-unlock-next>
