"use client";

/**
 * Concentric distance rings overlay for the approach map
 */

import { DEFAULT_RING_DISTANCES } from "@adsb/shared";
import { Circle, Tooltip } from "react-leaflet";

interface RingOverlayProps {
  centerLat: number;
  centerLon: number;
}

const NM_TO_METERS = 1852;

const styles = {
  ring: {
    color: "#9ca3af",
    weight: 1,
    fillOpacity: 0,
    dashArray: "4,4",
  },
  innerRing: {
    color: "#6b7280",
    weight: 1.5,
    fillOpacity: 0,
    dashArray: "4,4",
  },
};

export function RingOverlay({ centerLat, centerLon }: RingOverlayProps) {
  return (
    <>
      {DEFAULT_RING_DISTANCES.map((distanceNm) => {
        const isInnerRing = distanceNm <= 10;
        const radiusMeters = distanceNm * NM_TO_METERS;

        return (
          <Circle
            key={distanceNm}
            center={[centerLat, centerLon]}
            radius={radiusMeters}
            pathOptions={isInnerRing ? styles.innerRing : styles.ring}
          >
            <Tooltip permanent direction="right" offset={[5, 0]}>
              <span style={{ fontSize: "10px", color: "#6b7280" }}>
                {distanceNm}nm
              </span>
            </Tooltip>
          </Circle>
        );
      })}
    </>
  );
}
