"use client";

import { useEffect, useRef, useState } from "react";

// Module-scoped cache: deelt resultaten tussen mounts/unmounts van
// dezelfde key zodat een tab-revisit instant rendert.
//
// Opzet (bewust minimaal — geen SWR-dependency):
//   - cache: laatste succesvolle data + timestamp per key
//   - inflight: dedup gelijktijdige fetches op dezelfde key
//   - subs: mount-callbacks per key zodat revalidatie naar alle mounts
//     propagatert
//
// Geen window-storage; alles leeft in memory zodat een hard refresh
// een verse roundtrip krijgt. Geschikt voor matig veranderende lijsten
// (saved-searches, lead-status, search-jobs, users).

type Entry<T> = { data: T; ts: number };

const cache = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const subs = new Map<string, Set<(data: unknown) => void>>();

function notify(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
  const set = subs.get(key);
  if (!set) return;
  for (const fn of set) fn(data);
}

// Public: prefetch de data voor een key (bv. on-hover). Doet niets als
// de data al recent in cache staat.
export function prefetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  maxAgeMs = 30_000,
) {
  const cached = cache.get(key) as Entry<T> | undefined;
  if (cached && Date.now() - cached.ts < maxAgeMs) return;
  if (inflight.has(key)) return;
  const p = fetcher()
    .then((data) => {
      notify(key, data);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p as Promise<unknown>);
}

export type FetchState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T; stale: boolean }
  | { kind: "error"; error: Error };

type Options = {
  // Hoe oud de cache mag zijn voordat we 'm in de achtergrond verversen.
  maxAgeMs?: number;
  // Skip cache, altijd opnieuw ophalen. Handig voor "refresh"-knoppen.
  refresh?: number;
};

// Lees uit module-cache, render direct als er data staat (stale OK),
// trigger achtergrond-revalidatie als nodig. SWR-light.
export function useCachedFetch<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: Options = {},
): FetchState<T> & { refetch: () => void } {
  const { maxAgeMs = 30_000, refresh = 0 } = opts;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const initial = key ? (cache.get(key) as Entry<T> | undefined) : undefined;
  const [state, setState] = useState<FetchState<T>>(
    initial
      ? {
          kind: "ready",
          data: initial.data,
          stale: Date.now() - initial.ts >= maxAgeMs,
        }
      : { kind: "loading" },
  );

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    // Subscribe — andere mounts/refetches updaten ons via notify().
    const set = subs.get(key) ?? new Set();
    const onUpdate = (data: unknown) => {
      if (cancelled) return;
      setState({ kind: "ready", data: data as T, stale: false });
    };
    set.add(onUpdate);
    subs.set(key, set);

    const cached = cache.get(key) as Entry<T> | undefined;
    const fresh = cached && Date.now() - cached.ts < maxAgeMs;

    // Toon onmiddellijk wat we hebben (potentieel stale).
    if (cached) {
      setState({
        kind: "ready",
        data: cached.data,
        stale: !fresh,
      });
    } else {
      setState({ kind: "loading" });
    }

    // Trigger fetch als data ontbreekt, stale is, of refresh-trigger
    // wijzigde.
    if (!fresh || refresh > 0) {
      const inFlight = inflight.get(key);
      if (inFlight) {
        // Iemand anders is al bezig — wacht erop.
        inFlight
          .then((data) => !cancelled && notify(key, data))
          .catch((err) => {
            if (cancelled) return;
            setState({
              kind: "error",
              error: err instanceof Error ? err : new Error(String(err)),
            });
          });
      } else {
        const p = fetcherRef
          .current()
          .then((data) => {
            notify(key, data);
            return data;
          })
          .catch((err) => {
            if (cancelled) return;
            setState({
              kind: "error",
              error: err instanceof Error ? err : new Error(String(err)),
            });
            throw err;
          })
          .finally(() => inflight.delete(key));
        inflight.set(key, p as Promise<unknown>);
      }
    }

    return () => {
      cancelled = true;
      set.delete(onUpdate);
    };
  }, [key, maxAgeMs, refresh]);

  function refetch() {
    if (!key) return;
    cache.delete(key);
    inflight.delete(key);
    setState({ kind: "loading" });
    const p = fetcherRef
      .current()
      .then((data) => {
        notify(key, data);
        return data;
      })
      .catch((err) => {
        setState({
          kind: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
        throw err;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p as Promise<unknown>);
  }

  return { ...state, refetch };
}

// Manual cache-update — handig na een mutate (POST/PUT) zodat de UI
// niet hoeft te wachten op een revalidate.
export function setCache<T>(key: string, data: T) {
  notify(key, data);
}
