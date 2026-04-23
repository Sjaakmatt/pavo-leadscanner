import Link from "next/link";

export default function Header() {
  return (
    <header className="border-b border-pavo-gray-100 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-6 md:py-4">
        <Link
          href="/"
          className="text-base font-semibold tracking-tight text-pavo-teal md:text-lg"
        >
          PAVO Research Agent
        </Link>
        <span className="text-xs text-pavo-gray-600">
          Powered by FactumAI
        </span>
      </div>
    </header>
  );
}
