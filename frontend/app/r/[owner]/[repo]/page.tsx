import type { Metadata } from "next";

import Atlas from "@/components/Atlas";

type Params = Promise<{ owner: string; repo: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { owner, repo } = await params;
  const title = `${owner}/${repo} · Repo Atlas`;
  return { title, openGraph: { title }, twitter: { title } };
}

export default async function RepoPage({ params }: { params: Params }) {
  const { owner, repo } = await params;
  return <Atlas slug={`${decodeURIComponent(owner)}/${decodeURIComponent(repo)}`} />;
}
