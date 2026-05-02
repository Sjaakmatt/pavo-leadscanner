"use client";

import { useEffect, useState } from "react";

type ModeInfo = { mode: "demo" | "prod"; mcpConfigured: boolean };

// Kleine badge rechtsboven die toont of de app in demo of prod draait.
// Alleen zichtbaar in NODE_ENV=development — op prod willen we Roy
// niet lastigvallen met dev-diagnostics. In prod-mode zonder MCP-config
// tonen we een waarschuwing zodat duidelijk is dat de pijplijn nog
// geen externe data trekt.
export default function ModeBadge() {
  const [info, setInfo] = useState<ModeInfo | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    fetch("/api/mode")
      .then((r) => (r.ok ? (r.json() as Promise<ModeInfo>) : null))
      .then((data) => {
        if (data) setInfo(data);
      })
      .catch(() => {
        // silent — badge is puur informatief
      });
  }, []);

  if (!info) return null;
  const missingMcp = info.mode === "prod" && !info.mcpConfigured;
  const label = missingMcp ? "PROD · MCP-MISSING" : info.mode.toUpperCase();
  const styles =
    info.mode === "prod"
      ? missingMcp
        ? "border-amber-300/60 bg-amber-100/80 text-amber-900"
        : "border-emerald-300/60 bg-emerald-100/80 text-emerald-900"
      : "border-pavo-ink/[0.08] bg-white/70 text-pavo-gray-600";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-mono font-semibold tracking-wide backdrop-blur-sm ${styles}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}
