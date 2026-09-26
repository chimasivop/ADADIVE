import { useGetDeal, getGetDealQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, ArrowLeft, HardDrive, Coins, Clock, Hash } from "lucide-react";
import { format } from "date-fns";
import { useWallet } from "@/contexts/WalletContext";
import { useBackendSession } from "@/hooks/useBackendSession";
import { DealStatusCard } from "@/components/DealStatusCard";

const statusColors: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  completed: "secondary",
  pending: "outline",
  failed: "destructive",
};

export default function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const dealId = parseInt(id, 10);

  const { address } = useWallet();
  const { api, ensureSession } = useBackendSession();

  const { data: deal, isLoading } = useGetDeal(dealId, {
    query: { queryKey: getGetDealQueryKey(dealId), enabled: !!dealId }
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/deals">
          <button className="flex items-center gap-2 text-muted-foreground hover:text-primary font-mono text-sm transition-colors">
            <ArrowLeft className="size-4" /> Deals
          </button>
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-64 bg-primary/10" />
          <Skeleton className="h-48 w-full bg-primary/10" />
        </div>
      ) : deal ? (
        <>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-sm bg-card border border-border/50">
                  <Database className="size-6 text-primary" />
                </div>
                <h1 className="text-3xl font-bold font-mono tracking-tight text-primary-foreground">Deal #{deal.id}</h1>
                <Badge variant={statusColors[deal.status] ?? "outline"} className="font-mono">
                  {deal.status}
                </Badge>
              </div>
              <p className="font-mono text-sm text-muted-foreground">
                Created {format(new Date(deal.createdAt), "MMM d, yyyy 'at' HH:mm")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Storage" value={`${deal.storageGb} GB`} subtitle="Allocated" icon={HardDrive} />
            <StatCard title="Duration" value={`${deal.durationEpochs}`} subtitle="Epochs" icon={Clock} />
            <StatCard title="Total Cost" value={`◎ ${deal.totalCostAda.toFixed(2)}`} subtitle="SOL locked" icon={Coins} />
            <StatCard
              title="Provider"
              value={deal.providerName}
              subtitle={`ID: ${deal.providerId}`}
              icon={Database}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-card/50 border-primary/20">
              <CardHeader>
                <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground">Parties</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs font-mono text-muted-foreground mb-1">Provider</p>
                  <Link href={`/providers/${deal.providerId}`}>
                    <span className="font-mono text-primary hover:underline cursor-pointer">{deal.providerName}</span>
                  </Link>
                </div>
                <div>
                  <p className="text-xs font-mono text-muted-foreground mb-1">Client Address</p>
                  <p className="font-mono text-xs text-primary-foreground break-all">{deal.clientAddress}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-primary/20">
              <CardHeader>
                <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground">Epoch Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="font-mono text-sm text-muted-foreground">Start Epoch</span>
                  <span className="font-mono text-primary-foreground">
                    {deal.startEpoch != null ? deal.startEpoch : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-mono text-sm text-muted-foreground">End Epoch</span>
                  <span className="font-mono text-primary-foreground">
                    {deal.endEpoch != null ? deal.endEpoch : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-mono text-sm text-muted-foreground">Duration</span>
                  <span className="font-mono text-primary-foreground">{deal.durationEpochs} epochs</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card/50 border-primary/20">
            <CardHeader>
              <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Hash className="size-4" /> On-Chain Data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-mono text-muted-foreground mb-1">Data Hash</p>
                <p className="font-mono text-xs text-primary-foreground break-all bg-background/50 p-3 rounded border border-border/50">
                  {deal.dataHash}
                </p>
              </div>
              <div>
                <p className="text-xs font-mono text-muted-foreground mb-1">Transaction Hash</p>
                {deal.txHash ? (
                  <p className="font-mono text-xs text-primary break-all bg-background/50 p-3 rounded border border-border/50">
                    {deal.txHash}
                  </p>
                ) : (
                  <p className="font-mono text-sm text-muted-foreground italic">Pending on-chain confirmation</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Oracle-backed lifecycle: pin verification, the challenge window and
              settlement. Keyed by the deal's data hash, which is the deal id the
              oracle backend was given at registration. */}
          <Card className="bg-card/50 border-primary/20">
            <CardHeader>
              <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
                Settlement Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DealStatusCard
                api={api}
                dealId={deal.dataHash}
                wallet={address}
                ensureSession={ensureSession}
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="font-mono text-muted-foreground">Deal not found.</p>
      )}
    </div>
  );
}
