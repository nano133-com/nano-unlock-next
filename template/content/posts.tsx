// The blog's articles. Change this file to write your own. An article with a `price` has a paid part: the
// reader sees `free`, then pays, then sees `paid` too. The paid part is rendered on the server only, for a
// reader who holds a pass.

import type { ReactNode } from "react";

export const SITE = {
  name: "Field Notes",
  tagline: "Short articles. Some cost one cent.",
  author: "Your name",
};

export type Post = {
  slug: string;
  title: string;
  /** ISO date, for the list's order. */
  date: string;
  summary: string;
  minutes: number;
  /** The price of the paid part in US dollars. With none, the whole article is free. */
  price?: number;
  free: ReactNode;
  paid?: ReactNode;
};

export const POSTS: Post[] = [
  {
    slug: "one-cent-door",
    title: "Why some of these articles cost one cent",
    date: "2026-10-09",
    summary: "A free article about the small door on the other two.",
    minutes: 2,
    free: (
      <>
        <p>
          Most of what I write here is free to read. Two articles have a second half behind a small door, and the door costs one cent. This article says why,
          and how it works.
        </p>
        <h2>Why one cent</h2>
        <p>
          A card payment has a fixed fee of about thirty cents, so nobody can sell one article for one cent with a card. A subscription solves that for the
          seller, and gives the reader one more account to remember and one more charge to cancel.
        </p>
        <p>
          Nano is digital money with no fee and no minimum. A payment of one cent arrives as one cent, in about a second. That makes the price of a single
          article a real price again.
        </p>
        <h2>How it works</h2>
        <ol>
          <li>You press Unlock on a paid part.</li>
          <li>Your wallet opens with the amount filled in. You confirm.</li>
          <li>The page shows the rest of the article.</li>
        </ol>
        <p>
          There is no account and no email. The payment goes from your wallet to mine, with nobody in between. This site holds no key and no money: it only
          asks the Nano network if your payment arrived.
        </p>
        <h2>What you get</h2>
        <p>The paid part stays open in your browser for 30 days. If you clear your cookies, it closes again.</p>
      </>
    ),
  },
  {
    slug: "bread-on-a-workday",
    title: "A bread schedule that fits a workday",
    date: "2026-10-02",
    summary: "One loaf, four short steps, none of them during work hours.",
    minutes: 4,
    price: 0.01,
    free: (
      <>
        <p>
          Most bread recipes are written for a person who is at home all day. They ask for a fold at ten, a fold at eleven, a shape at two. I am at a desk at
          those times, and I still want bread on Saturday.
        </p>
        <p>
          The trick is not a faster recipe. It is a slower one. Cold dough moves so slowly that each step has a window of many hours, and a window of many
          hours always has an evening in it.
        </p>
        <h2>What you need</h2>
        <ul>
          <li>500 g of bread flour, 375 g of water, 10 g of salt</li>
          <li>100 g of active starter, or 2 g of dry yeast</li>
          <li>A bowl with a lid, and a pot with a lid that can go in the oven</li>
        </ul>
      </>
    ),
    paid: (
      <>
        <h2>The schedule</h2>
        <ol>
          <li>
            <b>Thursday, after dinner (10 minutes).</b> Mix everything in the bowl until no dry flour is left. Put the lid on. Leave it on the counter.
          </li>
          <li>
            <b>Thursday, before bed (2 minutes).</b> With a wet hand, pull one side of the dough up and fold it over. Turn the bowl and repeat four times. Put
            the bowl in the fridge.
          </li>
          <li>
            <b>Friday, any time after work (5 minutes).</b> Shape the cold dough into a tight ball on a floured table. Put it in a floured bowl, seam up,
            and back in the fridge.
          </li>
          <li>
            <b>Saturday morning (1 hour, mostly waiting).</b> Heat the oven and the pot to 240 °C for 30 minutes. Turn the dough into the pot, cut the top
            once, and bake 25 minutes with the lid and 20 minutes without.
          </li>
        </ol>
        <h2>Why the windows are so wide</h2>
        <p>
          At fridge temperature the dough rises about eight times slower than on the counter. Step 3 works anywhere from 12 to 30 hours after step 2, and
          step 4 anywhere from 10 to 40 hours after step 3. A late train does not ruin the loaf.
        </p>
        <p>Let the bread cool for an hour before you cut it. That is the hardest step, and the only one with no window.</p>
      </>
    ),
  },
  {
    slug: "five-photo-rules",
    title: "Five rules for photos of a walk",
    date: "2026-09-25",
    summary: "What I changed after ten years of photos that nobody looked at twice.",
    minutes: 3,
    price: 0.01,
    free: (
      <>
        <p>
          For ten years I came home from every walk with two hundred photos, and looked at none of them again. The hills were small, the sky was white, and
          every picture said the same thing: I was there.
        </p>
        <p>
          Then I gave myself five rules. I now come home with about twelve photos, and I print three or four of each walk. The rules need no camera better
          than a phone.
        </p>
        <h2>Rule 1: something near</h2>
        <p>
          A wide view has no size until something close is in it. Put a gate, a rock or a boot in the bottom third, one or two metres from you. The hills
          behind it become far away, which is what they are.
        </p>
      </>
    ),
    paid: (
      <>
        <h2>Rule 2: one subject</h2>
        <p>Say in three words what the photo is of, before you take it. &quot;The red barn.&quot; If you need more than three words, walk closer.</p>
        <h2>Rule 3: low sun or no sun</h2>
        <p>
          In the first and last hour of the day the light comes from the side and every stone has a shadow. At noon, look for shade, water or a wood, and
          leave the wide view for the way back.
        </p>
        <h2>Rule 4: turn round</h2>
        <p>At each stop, look behind you once. Half of my printed photos are of the path I had just walked.</p>
        <h2>Rule 5: twelve, then stop</h2>
        <p>
          Give the walk a limit of twelve photos, as an old roll of film did. With a limit you ask &quot;is this one of the twelve?&quot; and most of the
          time the true answer is no.
        </p>
      </>
    ),
  },
];

export const postBySlug = (slug: string) => POSTS.find((p) => p.slug === slug) ?? null;
