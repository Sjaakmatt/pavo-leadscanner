"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { Lead, Warmte } from "@/lib/adapters/types";
import { NL_CENTER } from "@/lib/filter";

type Props = {
  leads: Lead[];
};

// Warmte-colored dot marker — rendered via divIcon to avoid shipping
// Leaflet's default marker PNGs and to keep the palette consistent
// with the rest of the UI.
const COLORS: Record<Warmte, { fill: string; ring: string; glow: string }> = {
  HOT: { fill: "#FF6B47", ring: "#B85628", glow: "rgba(255,107,71,0.45)" },
  WARM: { fill: "#F5C84A", ring: "#A88E30", glow: "rgba(245,200,74,0.40)" },
  COLD: { fill: "#CED4DA", ring: "#6C757D", glow: "rgba(206,212,218,0.30)" },
};

function markerIcon(warmte: Warmte): L.DivIcon {
  const c = COLORS[warmte];
  const size = warmte === "HOT" ? 22 : warmte === "WARM" ? 18 : 14;
  return L.divIcon({
    className: "pavo-result-marker",
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: ${c.fill};
      border: 2px solid white;
      box-shadow: 0 0 0 1.5px ${c.ring}, 0 4px 12px ${c.glow};
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Auto-fit viewport to contain every marker. Re-runs when the set of
// coords changes.
function FitToBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length === 0) return;
    if (coords.length === 1) {
      map.setView(coords[0], 10, { animate: true });
      return;
    }
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
  }, [coords, map]);
  return null;
}

export default function ResultsMap({ leads }: Props) {
  const placed = useMemo(
    () => leads.filter((l) => l.lat !== undefined && l.lng !== undefined),
    [leads],
  );
  const coords = useMemo<[number, number][]>(
    () => placed.map((l) => [l.lat as number, l.lng as number]),
    [placed],
  );

  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-2xl border border-pavo-ink/[0.06] shadow-card">
      <MapContainer
        center={NL_CENTER}
        zoom={7}
        minZoom={6}
        maxZoom={14}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='Kaartgegevens &copy; <a href="https://www.kadaster.nl" target="_blank" rel="noreferrer">Kadaster</a>'
          url="https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png"
        />
        <FitToBounds coords={coords} />
        {placed.map((lead) => (
          <Marker
            key={lead.id}
            position={[lead.lat as number, lead.lng as number]}
            icon={markerIcon(lead.warmte)}
          >
            <Popup>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-pavo-navy">
                  {lead.naam}
                </div>
                <div className="text-xs text-pavo-gray-600">
                  {lead.plaats} · {lead.fte_klasse} FTE · {lead.warmte}
                </div>
                {lead.archetype && (
                  <div className="text-xs italic text-pavo-gray-600">
                    {lead.archetype.naam}
                  </div>
                )}
                <Link
                  href={`/lead/${lead.kvk}`}
                  className="mt-1 inline-block text-xs font-semibold text-pavo-teal hover:underline"
                >
                  Bekijk uitleg →
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Compacte legenda rechtsonder */}
      <div className="pointer-events-none absolute bottom-3 right-3 rounded-xl border border-pavo-ink/[0.06] bg-white/90 px-3 py-2 text-xs shadow-card backdrop-blur-sm">
        <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-pavo-gray-600">
          Warmte
        </div>
        <div className="flex flex-col gap-1.5">
          {(["HOT", "WARM", "COLD"] as const).map((w) => (
            <div key={w} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: COLORS[w].fill,
                  boxShadow: `0 0 0 1.5px ${COLORS[w].ring}`,
                }}
              />
              <span className="font-medium text-pavo-navy">{w}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
