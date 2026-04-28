"use client";

import { useEffect, useState } from "react";
import type { SearchFilters } from "@/lib/adapters/types";

type SavedSearch = {
  id: string;
  naam: string;
  filters: SearchFilters;
  alert_enabled: boolean;
};

type Props = {
  filters: SearchFilters;
  onLoad: (filters: SearchFilters) => void;
};

// Compacte UI voor "zoekopdracht opslaan" + dropdown om er een terug
// te laden. Degradeert silent: als /api/saved-searches 401/503
// retourneert (auth uit, of niet ingelogd) verbergen we de hele knop.
export default function SavedSearchControls({ filters, onLoad }: Props) {
  const [available, setAvailable] = useState(true);
  const [items, setItems] = useState<SavedSearch[]>([]);
  const [open, setOpen] = useState(false);
  const [naam, setNaam] = useState("");
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const res = await fetch("/api/saved-searches");
      if (res.status === 401 || res.status === 503) {
        setAvailable(false);
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as { searches: SavedSearch[] };
      setItems(body.searches);
    } catch {
      // silent
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleSave() {
    if (saving || !naam.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naam: naam.trim(),
          filters,
          alert_enabled: alertEnabled,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Opslaan faalde");
        return;
      }
      setNaam("");
      setAlertEnabled(false);
      setOpen(false);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Weet je zeker dat je deze zoekopdracht wilt verwijderen?")) {
      return;
    }
    const res = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
    if (res.ok) await reload();
  }

  if (!available) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-pavo-gray-100 bg-white px-3 py-1.5 text-xs font-medium text-pavo-gray-900 transition-colors hover:border-pavo-teal hover:text-pavo-teal"
      >
        <BookmarkIcon className="h-3.5 w-3.5" />
        Opgeslagen ({items.length})
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-pavo-gray-100 bg-white p-3 shadow-md">
          {items.length > 0 && (
            <div className="mb-3 max-h-60 overflow-y-auto">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
                Geladen
              </p>
              <ul className="space-y-1">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-pavo-gray-50"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onLoad(it.filters);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 truncate text-left text-pavo-gray-900 hover:text-pavo-teal"
                    >
                      {it.naam}
                      {it.alert_enabled && (
                        <span className="ml-1 text-[10px] text-pavo-orange">
                          • alert
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(it.id)}
                      className="text-pavo-gray-600 hover:text-pavo-orange"
                      aria-label="Verwijder"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t border-pavo-gray-100 pt-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
              Huidige filters opslaan
            </p>
            <input
              type="text"
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              placeholder="bv. 'Bouw 30-50 FTE Utrecht'"
              className="w-full rounded-md border border-pavo-gray-100 bg-white px-2 py-1.5 text-xs placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none"
            />
            <label className="mt-2 flex items-center gap-1.5 text-xs text-pavo-gray-900">
              <input
                type="checkbox"
                checked={alertEnabled}
                onChange={(e) => setAlertEnabled(e.target.checked)}
                className="h-3.5 w-3.5 accent-pavo-teal"
              />
              Notificeer bij nieuwe matches
            </label>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !naam.trim()}
              className="mt-2 w-full rounded-md bg-pavo-teal px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-pavo-teal-dark disabled:opacity-50"
            >
              {saving ? "Opslaan…" : "Opslaan"}
            </button>
            {error && (
              <p className="mt-1.5 text-[10px] text-pavo-orange">{error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BookmarkIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M5 3h10v14l-5-3-5 3z" />
    </svg>
  );
}
