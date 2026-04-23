"use client";

import { useEffect } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLng } from "@/lib/adapters/types";
import { NL_CENTER } from "@/lib/filter";

type Props = {
  center: LatLng | null;
  radiusKm: number;
  onPick: (c: LatLng) => void;
};

// Custom teal pin as divIcon — avoids shipping Leaflet's default
// marker PNGs, which need extra webpack config to resolve.
const pinIcon = L.divIcon({
  className: "pavo-pin",
  html: `
    <svg viewBox="0 0 24 32" width="24" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M12 1c-6 0-11 4.7-11 10.5 0 7.9 11 19.5 11 19.5s11-11.6 11-19.5C23 5.7 18 1 12 1z" fill="#1B5F6C" stroke="#0F3E47" stroke-width="1.2"/>
      <circle cx="12" cy="11" r="4" fill="#ffffff"/>
    </svg>
  `,
  iconSize: [24, 32],
  iconAnchor: [12, 30],
});

function ClickCatcher({ onPick }: { onPick: (c: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// Pans the map to the new center when the pin moves externally (e.g. on reset).
function FlyToCenter({ center }: { center: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo([center.lat, center.lng], Math.max(map.getZoom(), 9), {
        duration: 0.4,
      });
    }
  }, [center, map]);
  return null;
}

export default function MapPicker({ center, radiusKm, onPick }: Props) {
  return (
    <MapContainer
      center={NL_CENTER}
      zoom={7}
      minZoom={6}
      maxZoom={14}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
      className="pavo-map"
    >
      <TileLayer
        attribution='Kaartgegevens &copy; <a href="https://www.kadaster.nl" target="_blank" rel="noreferrer">Kadaster</a>'
        url="https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png"
      />
      <ClickCatcher onPick={onPick} />
      <FlyToCenter center={center} />
      {center && (
        <>
          <Marker position={[center.lat, center.lng]} icon={pinIcon} />
          <Circle
            center={[center.lat, center.lng]}
            radius={radiusKm * 1000}
            pathOptions={{
              color: "#1B5F6C",
              weight: 1.5,
              fillColor: "#1B5F6C",
              fillOpacity: 0.08,
            }}
          />
        </>
      )}
    </MapContainer>
  );
}
