import type { AudienceKind } from "./auth";

/**
 * Auto-generated campaign nomenclature, e.g. PAX_MKT_MX_BRAND_FIELD_PROMO.
 * Single source of truth shared by the Builder (live preview + cohort file
 * name) and the calendar export in "Mis campañas".
 */
export function buildNomenclature(
  kind: AudienceKind,
  country: string,
  team: string,
  subTeam: string | null | undefined,
  name: string,
): string {
  const parts = [kind === "pax" ? "PAX MKT" : "DRV MKT"];
  if (country) parts.push(country);
  if (team) parts.push(team);
  if (subTeam) parts.push(subTeam);
  if (name) parts.push(name);
  return parts
    .join("_")
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
}
