export default function Home() {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 text-zinc-900">
      <main className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-zinc-500">
            LIA Coach
          </p>
          <h1 className="mt-2 text-3xl font-semibold">LIA Coach</h1>
          <p className="mt-3 text-sm text-zinc-500">{today}</p>
        </header>

        <section className="flex flex-col gap-4">
          <button className="w-full rounded-2xl border border-zinc-200 bg-white px-5 py-6 text-left text-lg font-medium shadow-sm transition hover:border-zinc-300 hover:shadow">
            Chat
          </button>
          <button className="w-full rounded-2xl border border-zinc-200 bg-white px-5 py-6 text-left text-lg font-medium shadow-sm transition hover:border-zinc-300 hover:shadow">
            Log
          </button>
          <button className="w-full rounded-2xl border border-zinc-200 bg-white px-5 py-6 text-left text-lg font-medium shadow-sm transition hover:border-zinc-300 hover:shadow">
            History
          </button>
        </section>
      </main>
    </div>
  );
}
