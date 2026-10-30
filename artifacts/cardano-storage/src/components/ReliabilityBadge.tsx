import { useGetProviderAdvisory, getGetProviderAdvisoryQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { riskVisual } from "@/lib/reliability";
import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";

/**
 * A risk level already known by the caller, so the badge can render without
 * fetching the per-provider advisory.
 *
 * Used by `RecommendedProviders`: the recommendation response already carries
 * each candidate's level, so re-fetching one advisory per candidate would be
 * three redundant calls. `level` is a risk level (or "unknown"); `label` is the
 * text to show (which may be "Not enough evidence", a case with no risk level).
 */
export interface ReliabilityBadgePreset {
  label: string;
  level: string;
  title?: string;
}

interface ReliabilityBadgeProps {
  providerId?: number;
  className?: string;
  /** Rendered while the assessment is loading or unavailable. */
  showUnknown?: boolean;
  /** When set, render this instead of fetching the advisory. */
  preset?: ReliabilityBadgePreset;
}

const ICONS = {
  low: ShieldCheck,
  medium: ShieldAlert,
  high: ShieldAlert,
  unknown: ShieldQuestion,
} as const;

/**
 * The compact reliability badge for a provider row.
 *
 * By default it reads the same read-only advisory endpoint the detail panel
 * uses; the server caches per provider, so a list of badges does not fan out
 * into a burst of model calls. When the advisor is not configured, or the query
 * fails, it renders nothing (unless `showUnknown`), so an absent advisor never
 * becomes an error state on the directory.
 *
 * With `preset` it renders a level the caller already has and makes no request
 * at all — the path the recommendation list uses.
 */
export function ReliabilityBadge({
  providerId,
  className,
  showUnknown = false,
  preset,
}: ReliabilityBadgeProps) {
  const { data, isLoading } = useGetProviderAdvisory(providerId as number, undefined, {
    query: {
      queryKey: getGetProviderAdvisoryQueryKey(providerId as number),
      enabled: preset === undefined && Number.isFinite(providerId),
      staleTime: 60_000,
    },
  });

  if (preset !== undefined) {
    const visual = riskVisual(preset.level);
    const Icon = ICONS[preset.level as keyof typeof ICONS] ?? ShieldQuestion;
    return (
      <Badge
        variant="outline"
        className={cn("font-mono uppercase text-[10px] tracking-wider", visual.colorClass, className)}
        title={preset.title ?? `Reliability advisor: ${preset.label}`}
      >
        <Icon className="size-3 mr-1" />
        {preset.label}
      </Badge>
    );
  }

  if (isLoading) {
    return (
      <Badge
        variant="outline"
        className={cn("font-mono uppercase text-[10px] tracking-wider bg-muted/30 text-muted-foreground", className)}
      >
        …
      </Badge>
    );
  }

  if (!data?.available || !data.assessment) {
    if (!showUnknown) return null;
    const visual = riskVisual("unknown");
    return (
      <Badge variant="outline" className={cn("font-mono uppercase text-[10px] tracking-wider", visual.colorClass, className)}>
        <ShieldQuestion className="size-3 mr-1" />
        {visual.label}
      </Badge>
    );
  }

  const level = data.assessment.risk_level;
  const visual = riskVisual(level);
  const Icon = ICONS[level as keyof typeof ICONS] ?? ShieldQuestion;

  return (
    <Badge
      variant="outline"
      className={cn("font-mono uppercase text-[10px] tracking-wider", visual.colorClass, className)}
      title={`Reliability advisor: ${visual.label}${data.cached ? " (cached)" : ""}`}
    >
      <Icon className="size-3 mr-1" />
      {visual.label}
    </Badge>
  );
}
