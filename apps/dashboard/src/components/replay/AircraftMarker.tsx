"use client";

/**
 * Aircraft marker with rotation and rank coloring
 */

import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { Marker, Tooltip, useMap } from "react-leaflet";

import type { AircraftStateAtTimestamp } from "@/lib/api";
import { getRankColor } from "@/lib/colors";

interface AircraftMarkerProps {
  aircraft: AircraftStateAtTimestamp;
  isSelected: boolean;
  hasRankChanged: boolean;
  onClick: () => void;
}

function createAircraftIcon(
  color: string,
  rotation: number,
  isSelected: boolean,
  isPulsing: boolean
): L.DivIcon {
  const size = isSelected ? 28 : 22;
  const borderWidth = isSelected ? 3 : 2;
  const borderColor = isSelected ? "#3b82f6" : "#1f2937";

  const pulseAnimation = isPulsing
    ? `
      @keyframes pulse-${color.replace("#", "")} {
        0%, 100% { transform: scale(1) rotate(${rotation}deg); }
        50% { transform: scale(1.3) rotate(${rotation}deg); }
      }
      animation: pulse-${color.replace("#", "")} 0.5s ease-in-out 4;
    `
    : `transform: rotate(${rotation}deg);`;

  const html = `
    <div style="
      width: ${size}px;
      height: ${size}px;
      position: relative;
      ${pulseAnimation}
    ">
      <svg viewBox="0 0 24 24" width="${size}" height="${size}" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));">
        <path
          d="M12 2 L12 10 L4 18 L4 20 L12 16 L20 20 L20 18 L12 10 Z"
          fill="${color}"
          stroke="${borderColor}"
          stroke-width="${borderWidth}"
        />
      </svg>
    </div>
  `;

  return L.divIcon({
    html,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function AircraftMarker({
  aircraft,
  isSelected,
  hasRankChanged,
  onClick,
}: AircraftMarkerProps) {
  const map = useMap();
  const markerRef = useRef<L.Marker>(null);

  const color = useMemo(() => {
    if (aircraft.rankDistance !== null && aircraft.cohortSize !== null) {
      return getRankColor(aircraft.rankDistance, aircraft.cohortSize);
    }
    return "#9ca3af";
  }, [aircraft.rankDistance, aircraft.cohortSize]);

  const rotation = aircraft.track ?? 0;

  const icon = useMemo(
    () => createAircraftIcon(color, rotation, isSelected, hasRankChanged),
    [color, rotation, isSelected, hasRankChanged]
  );

  // Pan to selected aircraft
  useEffect(() => {
    if (isSelected && markerRef.current) {
      map.panTo([aircraft.lat, aircraft.lon], { animate: true, duration: 0.5 });
    }
  }, [isSelected, aircraft.lat, aircraft.lon, map]);

  const tooltipContent = [
    aircraft.callsign ?? aircraft.icao,
    aircraft.altBaro !== null
      ? `${Math.round(aircraft.altBaro).toLocaleString()} ft`
      : null,
    aircraft.gs !== null ? `${Math.round(aircraft.gs)} kts` : null,
    aircraft.rankDistance !== null && aircraft.cohortSize !== null
      ? `Rank: ${aircraft.rankDistance}/${aircraft.cohortSize}`
      : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return (
    <Marker
      ref={markerRef}
      position={[aircraft.lat, aircraft.lon]}
      icon={icon}
      eventHandlers={{
        click: onClick,
      }}
    >
      <Tooltip direction="top" offset={[0, -12]}>
        <span style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
          {tooltipContent}
        </span>
      </Tooltip>
    </Marker>
  );
}
