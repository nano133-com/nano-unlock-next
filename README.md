# Nano Unlock for Next.js

Sell part of a page for a few cents in Nano (XNO). The reader pays **your own Nano address** directly, and
**your site** checks the payment at a Nano node. There is no account, no card and no service in between. The
package never holds a key or any money, and it needs no database.

> **Status: in development.** The payment check and the pass are built and tested. The checkout (the amount,
> the QR code, the wait) is not switched on yet, so this build takes no payment. Nothing is published to npm.

This repository holds:

| Folder | What it is |
|---|---|
| `packages/unlock` | `@nano133/unlock`: the core (no framework) and the Next.js part (`@nano133/unlock/next`) |
| `template` | A small blog in Next.js with 3 articles: 1 free, 2 with a paid part at 1 cent |

## Deploy the blog to Vercel

<!-- DEPLOY BUTTON: this needs the public repository's address, which does not exist yet. When it does, put
     the button here. The link's form (Vercel docs, "Deploy Button"):

     https://vercel.com/new/clone?repository-url=<REPOSITORY URL>/tree/main/template
       &project-name=nano-unlock-blog&repository-name=nano-unlock-blog
       &env=NANO_ADDRESS,UNLOCK_SECRET
       &envDescription=Your%20Nano%20address%20and%20a%20long%20random%20secret
       &envLink=<REPOSITORY URL>%23settings

     The link must never carry a value for a setting. -->

*The "Deploy to Vercel" button comes here when the repository is public.* It copies the blog into your own
Git account, asks for the two settings below, and builds the site.

## Add it to your own Next.js site

Next.js 15 or 16 (App Router), Node.js 20.9 or newer.

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

**There is no default address, and this repository holds no address.** With a setting absent or wrong, the
blog shows a setup page that names the setting, and `<Unlock>` shows a notice in place of the button. No
reader is asked to pay until every setting is sound.

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

## The pass

After a payment the reader's browser holds a pass: a signed, httpOnly cookie that names the item and its end
time, and nothing about the reader. A pass lasts 30 days from the start of its checkout. One cookie keeps the
newest passes that fit in 2,800 bytes.

Limits to know:

- A pass is a cookie of one browser. A person who copies it has the same access until it ends.
- Only a new `UNLOCK_SECRET` ends a pass early, and it ends every pass.
- The site keeps no list of sales. Your wallet's history is the record.
- Nobody can stop a reader from copying text that they unlocked.

## Develop

```sh
npm install
npm test          # the payment check and the pass, against a mock node on this machine
npm run typecheck
npm run dev       # the blog on http://localhost:3000 (it shows the setup page until .env.local is filled in)
```

The tests make their addresses at run time and talk only to a mock node on `127.0.0.1`. Never put an address
in a file of this repository, and never show a pay step that runs on a mock node: a reader could send real
money to an address that nobody holds.

## Licence

MIT.
