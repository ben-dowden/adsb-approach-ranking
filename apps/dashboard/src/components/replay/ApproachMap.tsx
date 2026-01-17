"use client";

/**
 * Leaflet map container for approach visualization
 */

import L from "leaflet";
import { MapContainer, TileLayer, Marker, Tooltip } from "react-leaflet";

import type { AircraftStateAtTimestamp } from "@/lib/api";

import { AircraftMarker } from "./AircraftMarker";
import { RingOverlay } from "./RingOverlay";

interface ApproachMapProps {
  centerLat: number;
  centerLon: number;
  aircraft: AircraftStateAtTimestamp[];
  selectedAircraft: string | null;
  previousStates: Map<string, AircraftStateAtTimestamp>;
  onSelectAircraft: (icao: string | null) => void;
}

const styles = {
  container: {
    height: "100%",
    width: "100%",
  },
};

// Airport icon
const airportIcon = L.divIcon({
  html: `
    <div style="
      width: 16px;
      height: 16px;
      background: #1f2937;
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    "></div>
  `,
  className: "",
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export function ApproachMap({
  centerLat,
  centerLon,
  aircraft,
  selectedAircraft,
  previousStates,
  onSelectAircraft,
}: ApproachMapProps) {
  return (
    <div style={styles.container}>
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={8}
        style={{ height: "100%", width: "100%" }}
        zoomControl={true}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />

        {/* Distance rings */}
        <RingOverlay centerLat={centerLat} centerLon={centerLon} />

        {/* Airport marker */}
        <Marker position={[centerLat, centerLon]} icon={airportIcon}>
          <Tooltip permanent direction="bottom" offset={[0, 8]}>
            <span style={{ fontSize: "11px", fontWeight: 600 }}>Airport</span>
          </Tooltip>
        </Marker>

        {/* Aircraft markers */}
        {aircraft.map((ac) => {
          const previous = previousStates.get(ac.icao);
          const hasRankChanged =
            previous !== undefined &&
            previous.rankDistance !== null &&
            ac.rankDistance !== null &&
            previous.rankDistance !== ac.rankDistance;

          return (
            <AircraftMarker
              key={ac.icao}
              aircraft={ac}
              isSelected={selectedAircraft === ac.icao}
              hasRankChanged={hasRankChanged}
              onClick={() =>
                onSelectAircraft(selectedAircraft === ac.icao ? null : ac.icao)
              }
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
