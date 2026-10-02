import { useGetProvider, getGetProviderQueryKey, useGetProviderDeals, getGetProviderDealsQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { HardDrive, ArrowLeft, Globe, Shield, Database, Coins, Clock } from "lucide-react";
import { format } from "date-fns";

export default function ProviderDetail() {
  const { id } = useParams<{ id: string }>();
  const providerId = parseInt(id, 10);

  const { data: provider, isLoading } = useGetProvider(providerId, {
    query: { queryKey: getGetProviderQueryKey(providerId), enabled: !!providerId }
  });

  const { data: deals, isLoading: dealsLoading } = useGetProviderDeals(providerId, {
    query: { queryKey: getGetProviderDealsQueryKey(providerId), enabled: !!providerId }
  });

  const utilization = provider && provider.totalStorageGb > 0
    ? (provider.usedStorageGb / provider.totalStorageGb) * 100
    : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/providers">
          <button className="flex items-center gap-2 text-muted-foreground hover:text-primary font-mono text-sm transition-colors">
            <ArrowLeft className="size-4" /> Providers
          </button>
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-64 bg-primary/10" />
          <Skeleton className="h-6 w-96 bg-primary/10" />
        </div>
      ) : provider ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <div className="p-2 rounded-sm bg-card border border-primary/15 shrink-0">
                  <HardDrive className="size-5 text-primary" />
                </div>
                <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: "clamp(16px,4vw,24px)", letterSpacing: "0.15em", color: "hsl(var(--primary))", fontWeight: 700 }}>
                  {provider.name}
                </h1>
                <Badge variant={provider.status === "active" ? "default" : "secondary"} className="font-mono">
                  {provider.status}
                </Badge>
              </div>
              <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "10px", color: "hsl(var(--muted-foreground))", letterSpacing: "0.05em", overflow: "hidden", textOverflow: "ellipsis" }}>
                {provider.nodeId}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", letterSpacing: "0.18em", color: "hsl(var(--muted-foreground))" }}>JOINED</p>
              <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "12px", color: "hsl(var(--foreground))" }}>
                {format(new Date(provider.createdAt), "MMM d, yyyy")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              title="Total Storage"
              value={`${(provider.totalStorageGb / 1024).toFixed(2)} TB`}
              subtitle={`${utilization.toFixed(1)}% utilized`}
              icon={HardDrive}
            />
            <StatCard
              title="Active Deals"
              value={provider.activeDeals ?? 0}
              subtitle="Current contracts"
              icon={Database}
            />
            <StatCard
              title="SOL Earned"
              value={`◎ ${(provider.totalSolEarned ?? 0).toLocaleString()}`}
              subtitle="Total lifetime"
              icon={Coins}
            />
            <StatCard
              title="Uptime"
              value={`${provider.uptimePercent?.toFixed(2) ?? "--"}%`}
              subtitle="Historical"
              icon={Shield}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-card/50 border-primary/20">
              <CardHeader>
                <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground">Pricing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-sm text-muted-foreground">Price per GB / Epoch</span>
                  <span className="font-mono font-bold text-primary">◎ {provider.pricePerGbPerEpoch.toFixed(6)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-mono text-sm text-muted-foreground">Region</span>
                  <span className="font-mono text-foreground flex items-center gap-1">
                    <Globe className="size-3 text-primary" /> {provider.region}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-mono text-sm text-muted-foreground">Reputation Score</span>
                  <span className="font-mono font-bold text-foreground">{provider.reputationScore.toFixed(1)} / 100</span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-primary/20">
              <CardHeader>
                <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground">Storage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-sm text-muted-foreground">Total Capacity</span>
                  <span className="font-mono text-foreground">{(provider.totalStorageGb / 1024).toFixed(2)} TB</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-mono text-sm text-muted-foreground">Used</span>
                  <span className="font-mono text-foreground">{(provider.usedStorageGb / 1024).toFixed(2)} TB</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-mono text-sm text-muted-foreground">Available</span>
                  <span className="font-mono text-primary">
                    {((provider.totalStorageGb - provider.usedStorageGb) / 1024).toFixed(2)} TB
                  </span>
                </div>
                <div className="h-2 bg-background rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(utilization, 100)}%` }} />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card/50 border-primary/20">
            <CardHeader>
              <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
                Deals ({deals?.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {dealsLoading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full bg-primary/10" />)}
                </div>
              ) : deals?.length === 0 ? (
                <p className="p-6 text-center font-mono text-muted-foreground text-sm">No deals yet</p>
              ) : (
                <div className="divide-y divide-border/50">
                  {deals?.map((deal) => (
                    <Link key={deal.id} href={`/deals/${deal.id}`}>
                      <div className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors cursor-pointer">
                        <div className="flex items-center gap-4">
                          <span className="font-mono text-xs text-muted-foreground">#{deal.id}</span>
                          <span className="font-mono text-sm text-foreground truncate max-w-[120px] md:max-w-[200px]">{deal.clientAddress}</span>
                        </div>
                        <div className="flex items-center gap-3 md:gap-6 text-right">
                          <div>
                            <p className="font-mono text-sm text-foreground">{deal.storageGb} GB</p>
                            <p className="font-mono text-xs text-muted-foreground">{deal.durationEpochs} epochs</p>
                          </div>
                          <div>
                            <p className="font-mono text-sm text-primary">◎ {deal.totalCostSol.toFixed(2)}</p>
                          </div>
                          <Badge
                            variant={deal.status === "active" ? "default" : deal.status === "completed" ? "secondary" : "outline"}
                            className="font-mono text-xs"
                          >
                            {deal.status}
                          </Badge>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="font-mono text-muted-foreground">Provider not found.</p>
      )}
    </div>
  );
}
