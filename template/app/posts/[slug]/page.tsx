import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Unlock, unlocked } from "@nano133/unlock/next";
import { postBySlug } from "@/content/posts";
import { longDate } from "../../format";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = postBySlug((await params).slug);
  return post ? { title: post.title, description: post.summary } : {};
}

export default async function PostPage({ params }: Props) {
  const post = postBySlug((await params).slug);
  if (!post) notFound();
  // The paid part leaves the server only for a reader with a pass. Without one it is not in the page at all.
  const open = post.price ? await unlocked(post.slug) : true;
  return (
    <article className="post">
      <Link href="/" className="back">
        ← All articles
      </Link>
      <h1>{post.title}</h1>
      <p className="meta">
        <time dateTime={post.date}>{longDate(post.date)}</time>
        <span>{post.minutes} min read</span>
      </p>
      <div className="prose">
        {post.free}
        {post.price && !open ? <Unlock item={post.slug} price={post.price} title="The rest of this article" /> : post.paid}
      </div>
    </article>
  );
}
