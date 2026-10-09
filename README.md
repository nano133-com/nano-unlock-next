# Nano Unlock for Next.js

Sell part of a page for a few cents in Nano (XNO). The reader pays **your own Nano address** directly, and
**your site** checks the payment at a Nano node. There is no account, no card and no service in between. The
package never holds a key or any money, and it needs no database.

> **Status: version 0, before its first release.** Nothing is published to npm yet.

This repository holds:

| Folder | What it is |
|---|---|
| `packages/unlock` | `@nano133/unlock`: the core (no framework) and the Next.js part (`@nano133/unlock/next`) |
| `template` | A small blog in Next.js with 3 articles: 1 free, 2 with a paid part at 1 cent |

## Deploy the blog to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnano133-com%2Fnano-unlock-next%2Ftree%2Fmain%2Ftemplate&project-name=nano-unlock-blog&repository-name=nano-unlock-blog&env=NANO_ADDRESS,UNLOCK_SECRET&envDescription=Your%20own%20Nano%20address%2C%20and%20a%20long%20random%20secret&envLink=https%3A%2F%2Fgithub.com%2Fnano133-com%2Fnano-unlock-next%23settings)

The button copies the blog into your own Git account, asks for the two settings below, and builds the site.
The link carries no value for a setting: you type both yourself.

To deploy this whole repository (for example your fork) and not the button's copy: set the project's
**Root Directory** to `template`. Nothing else: the blog's build first builds the local package
(`template/scripts/build-local-package.mjs`).

## Deploy the blog to Cloudflare

The blog also runs as a Cloudflare Worker, with the [OpenNext adapter](https://opennext.js.org/cloudflare).
A live one: <https://nano-unlock-blog.nano133.workers.dev>. In a copy of `template/`:

```sh
npm install
npx wrangler login
npx wrangler secret put NANO_ADDRESS     # your own Nano address
npx wrangler secret put UNLOCK_SECRET    # a long random text: openssl rand -base64 48
npm run deploy                            # builds with OpenNext and deploys the Worker
```

- An account with no `workers.dev` subdomain yet gets a warning and no address: register one in the dashboard
  (Workers & Pages), then run `npm run deploy` again.
- The secrets can be set before the first deploy.
- `npm run preview` runs the same Worker on your own computer (put the two settings in a file `.dev.vars` first).

<!-- DEPLOY TO CLOUDFLARE BUTTON: held until the default node counts each Worker's site by itself (gateway 1.0.8).
     Its link: https://deploy.workers.cloudflare.com/?url=https://github.com/nano133-com/nano-unlock-next/tree/main/template -->

What is different on Cloudflare Workers:

- **Use `@nano133/unlock` 0.1.1 or newer.** Version 0.1.0 cannot check a payment on Workers.
- **Next.js 16.3.8.** The template pins it: the OpenNext adapter (1.20.10) does not yet run Next.js 16.4.0.
- **Set your own node on Cloudflare (`NANO_NODE_URL`).** Today every Worker in the world reaches the default
  node from one shared address, so all sites on Cloudflare share its limit of about 120 calls a minute. A
  paying reader costs about 24 calls a minute. The default node is enough for a test, not for a busy site.
- **The site's own limits are weaker.** A Worker has many short instances, and each counts for itself. Use a
  Cloudflare rate limiting rule for `/api/unlock/*` if you need a true limit.
- **The price is shared through your zone's cache** for 5 minutes (the Cache API), so the three price feeds
  are not asked by each short instance. Code that runs in your own zone can write that cache.
- **With every price feed down for more than 5 minutes, no payment starts.** On a long-lived server the last
  good price serves for a day; a Worker's instance is too short for that.
- The settings must be **secrets** of the Worker. `wrangler.jsonc` sets `nodejs_compat` and a compatibility
  date after 2025-04-01, which the settings need.

## Add it to your own Next.js site

Next.js 15 or 16 (App Router), Node.js 20.9 or newer; on Vercel, on your own server, or on Cloudflare Workers.

1. Install the package.

   ```sh
   npm install @nano133/unlock
   ```

2. Make the file `app/api/unlock/[action]/route.ts`:

   ```ts
   import { handlers } from "@nano133/unlock/next";

   export const { GET, POST } = handlers();
   ```

3. Set the two settings (see [Settings](#settings)).

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

5. Deploy.

The paid part is rendered on the server only, for a reader who holds a pass. `unlocked` reads the request's
cookies, so Next.js renders the page for each request and does not store one reader's page for another.

## Settings

| Setting | Needed | What it is |
|---|---|---|
| `NANO_ADDRESS` | Yes | Your own Nano address, from your wallet's Receive screen. Readers pay this address. The last 8 characters are a checksum, so a typed error is refused. |
| `UNLOCK_SECRET` | Yes | A long random text that only your site knows (32 characters or more). It signs the readers' passes. Make one with `openssl rand -base64 48`. |
| `NANO_NODE_URL` | No | The Nano node that proves the payments. Default: `https://node.nano133.com/rpc`. Use your own node if you have one: its answers decide what your site unlocks. |
| `NANO_NODE_URL_2` | No | A second node. With it, a payment counts only when both nodes confirm the same send. |
| `UNLOCK_CLAIMS_PER_MINUTE` | No | How many times a minute one running instance may ask the node about a checkout. Default: 50 (2 node calls each; the default node allows about 120 calls a minute for one address). Set it higher with your own node. |

**There is no default address, and this repository holds no address.** With a setting absent or wrong, the
blog shows a setup page that names the setting, and `<Unlock>` shows a notice in place of the button. No
reader is asked to pay until every setting is sound.

**On your own server behind a proxy, set `NODE_ENV=production`** (`next start` does it): the cookies then get
`Secure` also when the proxy passes the request on as http.

**Test nodes are refused.** A node on plain `http`, on `localhost`, on a private network or under a name with
no dot cannot see a real payment, so the site treats it as a wrong setting.

## How a payment is checked

A block unlocks a paid part only when the node says all of this about it:

- it is **confirmed**;
- it is a **send**;
- its destination is **your address**;
- its amount is **exactly** the amount that the site asked for;
- the node **first saw it inside the checkout's time**. A block with no such time is refused.

A block's hash is only a place to look. Every fact comes from the node's own answer for that block. When a node
does not answer, nothing is unlocked. With two nodes, both must agree.

## How one address serves every reader

1. **The offer.** The page carries a signed offer: the item and its price. The reader cannot change the price.
   An offer is good for 15 minutes; an older page loads again by itself.
2. **The checkout.** The site turns the price into XNO at the current rate (three public feeds; two must
   agree within 10%, so one wrong feed sets no price), rounds it up to Ӿ0.0001, and adds a random **tail** below 10^20 raw (at most Ӿ0.0000000001). That
   exact amount tells this payment from every other, so no memo and no database is needed. The checkout is a
   signed text in an httpOnly cookie of the reader's browser.
3. **The pay step.** The reader gets a QR code and an "Open in wallet" link, which fill in the exact amount.
   **A typed amount or an exchange's withdrawal cannot send it: readers pay from a wallet.** The page asks
   the site every 5 seconds; the site asks the node (2 calls for each question).
4. **15 minutes, 24 hours.** The pay step is shown for 15 minutes. After that the page removes the amount,
   the QR code and the wallet button. A payment still counts for 24 hours from the checkout's start: the
   reader opens the article again in the same browser, or presses "I paid: check again".
5. **Finish later.** The pay step offers a link: the page's own address, then `#nano-unlock=` and the signed
   checkout. It works in another browser too. Opening it changes nothing: the page only asks the site if
   that checkout is paid. With it, a reader can also paste the payment's block hash from the wallet.
6. **The pass.** A paid checkout gives a pass for its item. A second question about the same checkout gives
   the same pass.

### A payment with no unlock

It can happen: a payment later than 24 hours, a wrong amount, a page that was closed with no finish-later
link kept in a browser that lost its cookies, an eleventh checkout in 24 hours in one browser (the cookie
keeps 10), or an address that received more than 50 payments inside one checkout's time (the
node lists 50). **The package holds no key, so it cannot send money back.** You see every payment in your
wallet: settle such a case by hand, from your wallet.

## The pass

After a payment the reader's browser holds a pass: a signed, httpOnly cookie that names the item and its end
time, and nothing about the reader. A pass lasts 30 days from the start of its checkout. One cookie keeps the
newest passes that fit in 2,800 bytes.

Limits to know:

- A pass is a cookie of one browser. A person who copies it has the same access until it ends. The same is
  true for a copied checkout or finish-later link together with its payment.
- There is no pass link for a second device in this version.
- **The finish-later link opens the paid part for anyone who has it,** once its payment is on the network,
  for the 24 hours of its checkout. The signed checkout is after the `#`: it is not sent to a server and is
  in no referrer, but a script on your page can read it.
- Only a new `UNLOCK_SECRET` ends a pass early, and it ends every pass.
- The site keeps no list of sales. Your wallet's history is the record.
- The site has no shared count of requests, so its own limits are best-effort (one count for each running
  instance). Use your host's rate limit for `/api/unlock/*` if you need a true one.
- Nobody can stop a reader from copying text that they unlocked.

## Develop

```sh
npm install
npm test          # the payment check, the checkout and the pass, against a mock node on this machine
npm run test:workers   # the same route code on the Cloudflare Workers runtime, on this machine (no account)
npm run typecheck
npm run dev       # the blog on http://localhost:3000 (it shows the setup page until .env.local is filled in)
```

The tests make their addresses at run time and talk only to a mock node on `127.0.0.1`. Never put an address
in a file of this repository, and never show a pay step that runs on a mock node: a reader could send real
money to an address that nobody holds.

## Licence

MIT.
