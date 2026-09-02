import { describe, expect, it } from "vitest";

import { normalizeCruiseAircraft } from "./normalize.js";

describe("normalizeCruiseAircraft", () => {
  it("retains registration, type, callsign, and cruise evidence", () => {
    const result = normalizeCruiseAircraft(
      {
        hex: "7c6de0",
        r: "vh-vzm",
        t: "b738",
        flight: " QFA1077 ",
        lat: -24.53,
        lon: 146.8,
        alt_baro: 39_000,
        gs: 536.4,
        baro_rate: 64,
      },
      new Date("2025-12-01T00:40:00Z")
    );

    expect(result).toMatchObject({
      icaoHex: "7C6DE0",
      registration: "VH-VZM",
      aircraftType: "B738",
      callsign: "QFA1077",
      operatorCode: "QFA",
      operatorName: "Qantas",
      altitudeFt: 39_000,
      groundSpeedKt: 536.4,
      verticalRateFpm: 64,
      onGround: false,
    });
  });

  it("retains unknown operator prefixes for audit", () => {
    const result = normalizeCruiseAircraft(
      {
        hex: "7c0001",
        r: "VH-XYZ",
        t: "B738",
        flight: "ABC123",
        lat: -30,
        lon: 140,
      },
      new Date("2025-12-01T01:00:00Z")
    );

    expect(result).toMatchObject({ operatorCode: "ABC", operatorName: null });
  });

  it("rejects missing identity, non-B737, and out-of-envelope observations", () => {
    const ts = new Date("2025-12-01T01:00:00Z");

    expect(
      normalizeCruiseAircraft(
        { hex: "a", t: "B738", lat: -30, lon: 140 },
        ts
      )
    ).toBeNull();
    expect(
      normalizeCruiseAircraft(
        { hex: "b", r: "VH-A", t: "A320", lat: -30, lon: 140 },
        ts
      )
    ).toBeNull();
    expect(
      normalizeCruiseAircraft(
        { hex: "c", r: "VH-B", t: "B738", lat: -10, lon: 140 },
        ts
      )
    ).toBeNull();
  });

  it("converts ground altitude to a grounded state", () => {
    const result = normalizeCruiseAircraft(
      {
        hex: "7c0002",
        r: "VH-GND",
        t: "B738",
        flight: "VOZ2",
        lat: -33.94,
        lon: 151.18,
        alt_baro: "ground",
        gs: 0,
      },
      new Date("2025-12-01T01:00:00Z")
    );

    expect(result).toMatchObject({ altitudeFt: null, onGround: true });
  });
});
