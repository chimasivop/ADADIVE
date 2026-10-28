import { useGetProviderAdvisory, getGetProviderAdvisoryQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { riskVisual } from "@/lib/reliability";
import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";

interface ReliabilityBadgeProps {
  providerId: number;
  className?: string;
  /** Rendered while the assessment is loading or unavailable. */
  showUnknown?: boolean;
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
 * It reads the same read-only advisory endpoint the detail panel uses; the
 * server caches per provider, so a list of badges does not fan out into a burst
 * of model calls. When the advisor is not configured, or the query fails, it
 * renders nothing (unless `showUnknown`), so an absent advisor never becomes an
 * error state on the directory.
 */
export function ReliabilityBadge({ providerId, className, showUnknown = false }: ReliabilityBadgeProps) {
  const { data, isLoading } = useGetProviderAdvisory(providerId, undefined, {
    query: {
      queryKey: getGetProviderAdvisoryQueryKey(providerId),
      enabled: Number.isFinite(providerId),
      staleTime: 60_000,
    },
  });

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
