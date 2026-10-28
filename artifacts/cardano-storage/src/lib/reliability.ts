import type { ProviderAssessmentRiskLevel } from "@workspace/api-client-react";

/**
 * Presentation helpers for the reliability advisor's risk level.
 *
 * The advisor is advisory only, so the palette is deliberately *not* the deal
 * status palette: low is calm green, medium amber, high red, and unknown stays
 * neutral. Colours use the existing chart/status tokens so the badges sit in the
 * gold-on-black theme rather than importing new hues.
 */

export type RiskLevel = ProviderAssessmentRiskLevel;

export interface RiskVisual {
  label: string;
  colorClass: string;
  dotClass: string;
}

const VISUALS: Record<RiskLevel, RiskVisual> = {
  low: {
    label: "Low risk",
    colorClass: "bg-chart-4/15 text-chart-4 border-chart-4/30",
    dotClass: "bg-chart-4",
  },
  medium: {
    label: "Medium risk",
    colorClass: "bg-chart-2/15 text-chart-2 border-chart-2/30",
    dotClass: "bg-chart-2",
  },
  high: {
    label: "High risk",
    colorClass: "bg-destructive/15 text-destructive border-destructive/30",
    dotClass: "bg-destructive",
  },
  unknown: {
    label: "Unknown",
    colorClass: "bg-muted/40 text-muted-foreground border-border",
    dotClass: "bg-muted-foreground",
  },
};

/** The visual for a risk level, tolerating an unexpected value from the API. */
export function riskVisual(level: string | null | undefined): RiskVisual {
  if (level === "low" || level === "medium" || level === "high" || level === "unknown") {
    return VISUALS[level];
  }
  return VISUALS.unknown;
}
