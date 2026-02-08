import Link from "next/link";

export default function LogPage() {
  return (
    <section className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 text-zinc-900">
      <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
          Log
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Session notes hub</h1>
        <p className="mt-3 text-sm text-zinc-500">
          Capture prompts, insights, and outcomes in one place.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center text-sm font-medium text-zinc-900 underline-offset-4 transition hover:underline"
        >
          Back to Home
        </Link>
      </div>
    </section>
  );
}
