import { 
  useGetNetworkStats, getGetNetworkStatsQueryKey,
  useGetEconomyStats, getGetEconomyStatsQueryKey,
  useGetRecentActivity, getGetRecentActivityQueryKey
} from "@workspace/api-client-react";
import { THT } from "@/lib/token";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  HardDrive, Database, Activity, Coins, Clock, Globe,
  ArrowRightLeft, UserPlus, ServerCog, CheckCircle2, Shield
} from "lucide-react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar
} from "recharts";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: network, isLoading: networkLoading } = useGetNetworkStats({ 
    query: { queryKey: getGetNetworkStatsQueryKey() } 
  });
  
  const { data: economy, isLoading: economyLoading } = useGetEconomyStats({
    query: { queryKey: getGetEconomyStatsQueryKey() }
  });

  const { data: activity, isLoading: activityLoading } = useGetRecentActivity({
    query: { queryKey: getGetRecentActivityQueryKey() }
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold font-mono tracking-tight text-primary-foreground">Network Overview</h1>
        <p className="text-muted-foreground font-mono">Live telemetry from the Cardano decentralized storage economy.</p>
      </div>

      {/* Primary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Total Storage"
          value={network?.totalStorageTb ? `${network.totalStorageTb.toFixed(2)} TB` : undefined}
          subtitle={`${network?.networkUtilizationPercent.toFixed(1)}% Utilized`}
          icon={HardDrive}
          loading={networkLoading}
        />
        <StatCard 
          title="Active Deals"
          value={network?.activeDeals}
          subtitle={`${network?.totalDealsAllTime} All Time`}
          icon={Database}
          loading={networkLoading}
        />
        <StatCard 
          title="THT Locked"
          value={network?.totalAdaLocked ? THT.label(network.totalAdaLocked.toLocaleString()) : undefined}
          subtitle="In Active Escrow"
          icon={Coins}
          loading={networkLoading}
        />
        <StatCard 
          title="Avg Market Price"
          value={economy?.adaPerGbPerEpoch ? THT.label(economy.adaPerGbPerEpoch.toFixed(4)) : undefined}
          subtitle="per GB / Epoch"
          icon={Activity}
          loading={economyLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Charts */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
            <CardHeader>
              <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
                Market Price History (THT/GB/Epoch)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                {economyLoading ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <Activity className="size-6 text-primary animate-pulse" />
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={economy?.priceHistory || []} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis 
                        dataKey="epoch" 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={12}
                        tickFormatter={(val) => `Ep ${val}`}
                      />
                      <YAxis 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={12}
                        tickFormatter={(val) => `${val} THT`}
                      />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                        labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="priceAda" 
                        stroke="hsl(var(--primary))" 
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 6, fill: 'hsl(var(--primary))' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
              <CardHeader>
                <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
                  Storage by Region
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px] w-full">
                  {economyLoading ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <Activity className="size-6 text-primary animate-pulse" />
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={economy?.storageByRegion || []} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis 
                          dataKey="region" 
                          stroke="hsl(var(--muted-foreground))" 
                          fontSize={12}
                        />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                          cursor={{ fill: 'hsl(var(--primary)/0.1)' }}
                        />
                        <Bar 
                          dataKey="totalStorageTb" 
                          fill="hsl(var(--primary))" 
                          radius={[2, 2, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <StatCard 
                title="Active Providers"
                value={network?.activeProviders}
                subtitle={`Out of ${network?.totalProviders} total`}
                icon={ServerCog}
                loading={networkLoading}
              />
              <StatCard 
                title="Avg Reputation"
                value={network?.avgReputationScore ? `${network.avgReputationScore.toFixed(1)} / 100` : undefined}
                subtitle="Network Wide"
                icon={Shield}
                loading={networkLoading}
              />
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <Card className="bg-card/50 backdrop-blur-sm border-primary/20 h-[calc(100vh-12rem)] min-h-[600px] flex flex-col">
          <CardHeader className="border-b border-border/50 pb-4">
            <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Activity className="size-4" />
              Network Events
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-0">
            {activityLoading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="flex gap-4">
                    <Skeleton className="size-8 rounded-full bg-primary/10" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-full bg-primary/10" />
                      <Skeleton className="h-3 w-24 bg-primary/10" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {activity?.map((event) => {
                  let Icon = Clock;
                  let iconColor = "text-muted-foreground";
                  
                  if (event.type === "deal_created") { Icon = ArrowRightLeft; iconColor = "text-chart-2"; }
                  else if (event.type === "deal_activated") { Icon = Database; iconColor = "text-primary"; }
                  else if (event.type === "deal_completed") { Icon = CheckCircle2; iconColor = "text-chart-4"; }
                  else if (event.type === "provider_joined") { Icon = UserPlus; iconColor = "text-chart-3"; }
                  else if (event.type === "provider_updated") { Icon = ServerCog; iconColor = "text-muted-foreground"; }

                  return (
                    <div key={event.id} className="p-4 hover:bg-muted/30 transition-colors flex gap-4">
                      <div className={`mt-0.5 p-1.5 rounded-sm bg-background border border-border/50 ${iconColor}`}>
                        <Icon className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-sm font-mono text-foreground leading-snug">
                          {event.description}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground">
                          {format(new Date(event.timestamp), "MMM d, HH:mm:ss")}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
