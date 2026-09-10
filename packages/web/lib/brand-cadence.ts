export type BrandCadence = "weekly" | "monthly" | "paused";

export const MAX_WEEKLY_BRANDS = 2;

export function cadenceForNewBrand(activeBrandCount: number): BrandCadence {
  return activeBrandCount >= MAX_WEEKLY_BRANDS ? "monthly" : "weekly";
}

export function normalizeCadence(
  cadence: BrandCadence,
  activeBrandCount: number,
): BrandCadence {
  return cadence === "weekly" && activeBrandCount > MAX_WEEKLY_BRANDS
    ? "monthly"
    : cadence;
}
