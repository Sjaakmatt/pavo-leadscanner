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
  const color =
    info.mode === "prod"
      ? missingMcp
        ? "bg-amber-100 text-amber-900"
        : "bg-emerald-100 text-emerald-900"
      : "bg-slate-100 text-slate-700";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold ${color}`}
    >
      {label}
    </span>
  );
}
