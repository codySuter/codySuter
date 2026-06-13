import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="font-serif text-3xl font-bold">Not found</h1>
      <p className="text-muted">
        This page doesn&rsquo;t exist, or you don&rsquo;t have access to it.
      </p>
      <Link href="/campaigns" className="text-accent underline">
        Back to your campaigns
      </Link>
    </main>
  );
}
