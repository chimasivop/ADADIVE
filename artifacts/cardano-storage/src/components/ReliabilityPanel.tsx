import { useState } from "react";
import {
  useGetProviderAdvisory,
  getGetProviderAdvisoryQueryKey,
  type ProviderAssessment,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { riskVisual } from "@/lib/reliability";
import { Brain, RefreshCw, Quote, HelpCircle, ArrowRight, ShieldQuestion } from "lucide-react";

interface ReliabilityPanelProps {
  providerId: number;
}

function List({ title, items, icon: Icon }: { title: string; items: string[]; icon: React.ElementType }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: "9px",
          letterSpacing: "0.18em",
          color: "hsl(var(--muted-foreground))",
        }}
        className="flex items-center gap-1.5 mb-2"
      >
        <Icon className="size-3" />
        {title}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 font-mono text-xs text-foreground/90 leading-relaxed">
            <span className="text-primary/60 shrink-0">›</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The AI reliability advisor panel for a provider's detail page.
 *
 * Advisory only: it renders the model's structured assessment and nothing more.
 * It never offers an action that signs, releases funds or changes a deal — the
 * `recommended_action` is text for a human to read.
 *
 * The panel hides itself when the advisor is not configured (`available: false`)
 * and shows an inline retry when the query fails, so a missing or broken advisor
 * never breaks the page.
 */
export function ReliabilityPanel({ providerId }: ReliabilityPanelProps) {
  const [refresh, setRefresh] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useGetProviderAdvisory(
    providerId,
    refresh ? { refresh: "1" } : undefined,
    {
      query: {
        queryKey: getGetProviderAdvisoryQueryKey(providerId, refresh ? { refresh: "1" } : undefined),
        enabled: Number.isFinite(providerId),
        staleTime: 60_000,
      },
    }
  );

  const onRefresh = () => {
    // Ask the server to bypass a fresh cache entry, then fall back to a plain
    // refetch so a second click still does something.
    if (!refresh) setRefresh(true);
    else void refetch();
  };

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-primary/20">
        <CardHeader>
          <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Brain className="size-4 text-primary" /> Reliability Advisor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-40 bg-primary/10" />
          <Skeleton className="h-3 w-full bg-primary/10" />
          <Skeleton className="h-3 w-3/4 bg-primary/10" />
        </CardContent>
      </Card>
    );
  }

  // Not configured: hide entirely. This is a normal state, not a fault.
  if (!isError && data && !data.available) return null;

  if (isError) {
    return (
      <Card className="bg-card/50 border-primary/20">
        <CardHeader>
          <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Brain className="size-4 text-primary" /> Reliability Advisor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-xs text-muted-foreground mb-3">
            The advisor could not be reached. This does not affect the provider's status.
          </p>
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 font-mono text-xs text-primary hover:opacity-80 transition-opacity"
          >
            <RefreshCw className="size-3" /> Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  const assessment: ProviderAssessment | null = data?.assessment ?? null;
  if (!assessment) return null;

  const visual = riskVisual(assessment.risk_level);
  const isUnknown = assessment.risk_level === "unknown";

  return (
    <Card className="bg-card/50 border-primary/20">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Brain className="size-4 text-primary" /> Reliability Advisor
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("font-mono uppercase text-[10px] tracking-wider", visual.colorClass)}>
              {isUnknown ? <ShieldQuestion className="size-3 mr-1" /> : null}
              {visual.label}
            </Badge>
            <button
              onClick={onRefresh}
              disabled={isFetching}
              title="Ask the advisor for a fresh assessment"
              className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data?.demoLimitReached && data?.note && (
          <p
            className="font-mono text-xs rounded-sm px-3 py-2"
            style={{
              color: "#c9a96e",
              background: "rgba(201,169,110,0.08)",
              border: "1px solid rgba(201,169,110,0.28)",
            }}
          >
            {data.note}
          </p>
        )}

        {data?.inconclusive && (
          <p className="font-mono text-xs text-muted-foreground">
            Not enough evidence to judge yet. This is not a failure — the advisor reports{" "}
            <span className="text-foreground">unknown</span> rather than guessing.
          </p>
        )}

        <List title="REASONS" items={assessment.reasons} icon={Brain} />
        <List title="EVIDENCE CITED" items={assessment.evidence_cited} icon={Quote} />
        <List title="UNCERTAIN" items={assessment.uncertain} icon={HelpCircle} />

        {assessment.recommended_action && (
          <div className="pt-3 border-t border-border/50">
            <p
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: "9px",
                letterSpacing: "0.18em",
                color: "hsl(var(--muted-foreground))",
              }}
              className="flex items-center gap-1.5 mb-2"
            >
              <ArrowRight className="size-3" />
              RECOMMENDED ACTION
            </p>
            <p className="font-mono text-xs text-primary leading-relaxed">{assessment.recommended_action}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 border-t border-border/50">
          <span className="font-mono text-[10px] text-muted-foreground">{data?.disclaimer}</span>
          <span className="font-mono text-[10px] text-muted-foreground/70">
            {data?.model}
            {data?.mock ? " · mock" : ""}
            {data?.cached ? " · cached" : ""}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
