type Props = {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
};

// Consistente page-wrapper — zorgt dat alle subpages dezelfde
// container-breedte, padding en heading-stijl gebruiken.
export default function PageShell({ title, subtitle, action, children }: Props) {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 md:px-8 md:pt-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-pavo-navy md:text-[28px]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm text-pavo-gray-600">{subtitle}</p>
          )}
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

// Reusable "binnenkort" placeholder voor pages die nog geen backend
// hebben. Houdt visuele consistentie en signaleert duidelijk dat de
// feature on the roadmap staat.
export function ComingSoon({
  title,
  description,
  bullets = [],
  icon,
}: {
  title: string;
  description: string;
  bullets?: string[];
  icon: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-pavo-ink/[0.06] bg-gradient-to-br from-white via-pavo-cream to-pavo-frost/60 p-8 md:p-12">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-pavo-teal/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-pavo-orange/10 blur-3xl"
      />

      <div className="relative max-w-xl">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-pavo-teal to-pavo-navy text-white shadow-[0_10px_30px_-10px_rgba(15,62,71,0.5)]">
          {icon}
        </div>
        <div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-pavo-orange/20 bg-pavo-orange/[0.07] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pavo-orange">
          Binnenkort
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-pavo-navy md:text-3xl">
          {title}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-pavo-gray-600">
          {description}
        </p>

        {bullets.length > 0 && (
          <ul className="mt-5 space-y-2.5">
            {bullets.map((b) => (
              <li
                key={b}
                className="flex items-start gap-2.5 text-sm text-pavo-navy"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pavo-teal" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
