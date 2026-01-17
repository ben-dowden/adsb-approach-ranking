import { describe, expect, it } from "vitest";

import {
  closingRate,
  estimateTtgMin,
  haversineDistanceNm,
  toDegrees,
  toRadians,
} from "./geo.js";

describe("toRadians", () => {
  it("converts 0 degrees to 0 radians", () => {
    expect(toRadians(0)).toBe(0);
  });

  it("converts 180 degrees to PI radians", () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI);
  });

  it("converts 90 degrees to PI/2 radians", () => {
    expect(toRadians(90)).toBeCloseTo(Math.PI / 2);
  });
});

describe("toDegrees", () => {
  it("converts 0 radians to 0 degrees", () => {
    expect(toDegrees(0)).toBe(0);
  });

  it("converts PI radians to 180 degrees", () => {
    expect(toDegrees(Math.PI)).toBeCloseTo(180);
  });
});

describe("haversineDistanceNm", () => {
  it("returns 0 for same point", () => {
    expect(haversineDistanceNm(51.5, -0.1, 51.5, -0.1)).toBe(0);
  });

  it("calculates distance between London and Paris (~187 NM)", () => {
    const distance = haversineDistanceNm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(distance).toBeGreaterThan(180);
    expect(distance).toBeLessThan(195);
  });

  it("calculates short distance correctly", () => {
    // ~1 degree latitude at equator ≈ 60 NM
    const distance = haversineDistanceNm(0, 0, 1, 0);
    expect(distance).toBeGreaterThan(59);
    expect(distance).toBeLessThan(61);
  });
});

describe("closingRate", () => {
  it("returns negative rate when approaching", () => {
    expect(closingRate(10, 8, 60)).toBeCloseTo(-2);
  });

  it("returns positive rate when departing", () => {
    expect(closingRate(8, 10, 60)).toBeCloseTo(2);
  });

  it("returns 0 when time delta is 0", () => {
    expect(closingRate(10, 8, 0)).toBe(0);
  });
});

describe("estimateTtgMin", () => {
  it("returns null when not closing", () => {
    expect(estimateTtgMin(10, 2)).toBeNull();
  });

  it("calculates TTG correctly when closing", () => {
    expect(estimateTtgMin(10, -2)).toBeCloseTo(5);
  });

  it("returns null at zero closing rate", () => {
    expect(estimateTtgMin(10, 0)).toBeNull();
  });
});
