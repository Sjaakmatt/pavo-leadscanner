export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-8 md:px-8 md:pt-10">
      <div className="h-4 w-40 animate-pulse rounded-full bg-pavo-ink/[0.08]" />
      <div className="mt-6 h-32 animate-pulse rounded-3xl border border-pavo-ink/[0.06] bg-white/40 md:mt-8" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-2xl border border-pavo-ink/[0.06] bg-white/40"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
