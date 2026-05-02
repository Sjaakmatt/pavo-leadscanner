// Gedeelde page-loading skeleton — Next.js toont deze automatisch
// tijdens navigatie naar een route. Geeft instant feedback bij een
// tab-klik zodat de transitie niet "dood" voelt.

export default function PageSkeleton({
  rows = 5,
  showToolbar = false,
}: {
  rows?: number;
  showToolbar?: boolean;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-5 md:px-8 md:pt-6">
      {/* Page-header */}
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="space-y-2">
          <div className="h-7 w-32 animate-pulse rounded-md bg-pavo-ink/[0.08]" />
          <div className="h-4 w-72 animate-pulse rounded-md bg-pavo-ink/[0.05]" />
        </div>
        {showToolbar && (
          <div className="flex gap-2">
            <div className="h-8 w-28 animate-pulse rounded-full bg-pavo-ink/[0.06]" />
            <div className="h-8 w-28 animate-pulse rounded-full bg-pavo-ink/[0.06]" />
          </div>
        )}
      </div>

      {/* Body — generic stack */}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-2xl border border-pavo-ink/[0.06] bg-white/40"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// Kanban-skeleton voor de pipeline — toont 6 lege kolommen die qua
// shape lijken op de echte pipeline-kolommen.
export function KanbanSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-5 md:px-8 md:pt-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="space-y-2">
          <div className="h-7 w-28 animate-pulse rounded-md bg-pavo-ink/[0.08]" />
          <div className="h-4 w-80 animate-pulse rounded-md bg-pavo-ink/[0.05]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-64 animate-pulse rounded-2xl border border-pavo-ink/[0.06] bg-white/40"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
