import {
  useGetProviderRecommendations,
  getGetProviderRecommendationsQueryKey,
  type RecommendedProvider,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ReliabilityBadge } from "@/components/ReliabilityBadge";
import { Brain, HelpCircle, Sparkles } from "lucide-react";

interface RecommendedProvidersProps {
  storageGb: number;
  durationEpochs: number;
  region?: string | null;
  /** Pre-fill the provider picker with a candidate. Does nothing else. */
  onUseProvider: (providerId: number) => void;
}

const NOTE_STYLE = {
  color: "#c9a96e",
  background: "rgba(201,169,110,0.08)",
  border: "1px solid rgba(201,169,110,0.28)",
} as const;

function Section({
  title,
  items,
  icon: Icon,
}: {
  title: string;
  items: string[];
  icon: React.ElementType;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p
        className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground flex items-center gap-1.5 mb-1.5"
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        <Icon className="size-3" />
        {title}
      </p>
      <ul className="space-y-1">
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

function CandidateCard({
  candidate,
  onUse,
}: {
  candidate: RecommendedProvider;
  onUse: (providerId: number) => void;
}) {
  const isBest = candidate.rank === 1 && candidate.sufficientEvidence;
  return (
    <div
      className={cn(
        "rounded-sm border p-3 space-y-2",
        isBest ? "border-primary/40 bg-primary/5" : "border-border/50 bg-background/40"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">#{candidate.rank}</span>
            <span className="font-mono text-sm text-foreground truncate">{candidate.name}</span>
            {isBest && (
              <span className="font-mono text-[9px] uppercase tracking-wider text-primary">
                Best match
              </span>
            )}
          </div>
          <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
            {candidate.region} · {Math.round(candidate.availableGb)} GB free ·{" "}
            {candidate.pricePerGbPerEpoch} SOL/GB/epoch · est. {candidate.estimatedCostSol} SOL
          </p>
        </div>
        <ReliabilityBadge
          preset={{
            label: candidate.label,
            level: candidate.riskLevel,
            title:
              candidate.sufficientEvidence
                ? `Deterministic reliability score ${candidate.reliabilityScore}/100`
                : "Not enough evidence to judge this provider",
          }}
        />
      </div>

      <Section title="WHY" items={candidate.reasons} icon={Brain} />
      <Section title="UNCERTAIN" items={candidate.uncertain} icon={HelpCircle} />

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="font-mono text-[9px] text-muted-foreground">
          score {candidate.score}/100 ·{" "}
          {candidate.explanationSource === "ai" ? "AI explanation" : "deterministic explanation"}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="font-mono text-[10px] h-7"
          onClick={() => onUse(candidate.providerId)}
        >
          Use this provider
        </Button>
      </div>
    </div>
  );
}

/**
 * "Recommended providers" for the New Deal page.
 *
 * Advisory only. It renders the read-only ranking the server computed and lets
 * the customer pre-fill the picker — it never selects a provider, signs, or
 * changes the deal. The customer still picks the provider and still signs
 * everything themselves.
 *
 * It hides itself until the size and duration are known, hides on a query error,
 * and renders whatever the server returns (which is always the deterministic
 * ranking, even when the model is unavailable). So it can never break the page.
 */
export function RecommendedProviders({
  storageGb,
  durationEpochs,
  region,
  onUseProvider,
}: RecommendedProvidersProps) {
  const enabled = Number.isFinite(storageGb) && storageGb > 0 && durationEpochs > 0;

  const { data, isLoading, isError } = useGetProviderRecommendations(
    {
      storageGb,
      durationEpochs,
      region: region && region.trim().length > 0 ? region.trim() : undefined,
    },
    {
      query: {
        queryKey: getGetProviderRecommendationsQueryKey({
          storageGb,
          durationEpochs,
          region: region && region.trim().length > 0 ? region.trim() : undefined,
        }),
        enabled,
        staleTime: 60_000,
      },
    }
  );

  if (!enabled) {
    return (
      <Card className="bg-card/50 border-primary/20">
        <CardHeader>
          <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Recommended providers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-xs text-muted-foreground">
            Enter a storage size and duration to see advisory recommendations.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-primary/20">
        <CardHeader>
          <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Recommended providers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-48 bg-primary/10" />
          <Skeleton className="h-20 w-full bg-primary/10" />
          <Skeleton className="h-20 w-full bg-primary/10" />
        </CardContent>
      </Card>
    );
  }

  // A broken advisor must never break the form: hide the panel rather than
  // showing an error the customer cannot act on.
  if (isError || !data) return null;

  const candidates = data.candidates ?? [];

  return (
    <Card className="bg-card/50 border-primary/20">
      <CardHeader>
        <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> Recommended providers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.note && (
          <p className="font-mono text-xs rounded-sm px-3 py-2" style={NOTE_STYLE}>
            {data.note}
          </p>
        )}

        {candidates.length === 0 ? (
          <p className="font-mono text-xs text-muted-foreground">
            No provider currently matches this deal's size and region.
            {data.filteredOut > 0
              ? ` ${data.filteredOut} provider${data.filteredOut === 1 ? "" : "s"} were filtered out on capacity, region or price.`
              : ""}
          </p>
        ) : (
          <>
            {data.allInsufficientEvidence && (
              <p className="font-mono text-xs text-muted-foreground">
                Not enough evidence to recommend anyone here. Every candidate lacks a node or
                verification history, so none is labelled the best choice — review them manually.
              </p>
            )}

            <div className="space-y-3">
              {candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.providerId}
                  candidate={candidate}
                  onUse={onUseProvider}
                />
              ))}
            </div>

            <p className="font-mono text-[10px] text-muted-foreground">
              {data.candidates.length} of {data.consideredCount} considered
              {data.filteredOut > 0 ? `, ${data.filteredOut} filtered out` : ""}. You choose the
              provider and sign the deal — nothing here is applied automatically.
            </p>
          </>
        )}

        <p className="font-mono text-[10px] text-muted-foreground/70 pt-1 border-t border-border/50">
          {data.disclaimer}
        </p>
      </CardContent>
    </Card>
  );
}
