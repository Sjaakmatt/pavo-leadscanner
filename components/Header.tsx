import Link from "next/link";

export default function Header() {
  return (
    <header className="border-b border-pavo-gray-100 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-pavo-teal"
        >
          PAVO Research Agent
        </Link>
        <span className="text-xs text-pavo-gray-600">Powered by FactumAI</span>
      </div>
    </header>
  );
}
