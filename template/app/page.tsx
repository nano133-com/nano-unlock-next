import Link from "next/link";
import { POSTS } from "@/content/posts";
import { longDate, priceLabel } from "./format";

export default function Home() {
  const posts = [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ul className="list">
      {posts.map((p) => (
        <li key={p.slug}>
          <Link href={`/posts/${p.slug}`} className="card">
            <span className="meta">
              <time dateTime={p.date}>{longDate(p.date)}</time>
              <span>{p.minutes} min read</span>
              <span className={p.price ? "chip paid" : "chip"}>{p.price ? `Paid part · ${priceLabel(p.price)}` : "Free"}</span>
            </span>
            <h2>{p.title}</h2>
            <p>{p.summary}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
