import { formatPrice } from "./catalog.js";

export type CatalogPriceKind = "fixed" | "estimate_required" | "unavailable";

export interface CatalogPricePresentation {
  kind: CatalogPriceKind;
  /** Raw catalog USD value, retained for diagnostics rather than billing. */
  catalogUsd?: number;
  label: string;
}

/**
 * Temporary client-side safety policy until Cost API supplies authoritative
 * request-specific estimates. Similarweb's catalog price is a display value:
 * the actual charge can vary with scope or provider results, so it must never
 * be rendered as a fixed per-request customer price.
 */
export function presentCatalogPrice(providerId: string, catalogUsd?: number): CatalogPricePresentation {
  if (providerId.trim().toLowerCase() === "similarweb") {
    return { kind: "estimate_required", catalogUsd, label: "estimate required" };
  }
  if (catalogUsd == null) {
    return { kind: "unavailable", label: "—" };
  }
  if (catalogUsd === 0) {
    return { kind: "estimate_required", catalogUsd, label: "estimate required" };
  }
  return { kind: "fixed", catalogUsd, label: formatPrice(catalogUsd) };
}
