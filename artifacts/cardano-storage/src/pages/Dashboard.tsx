import { 
  useGetNetworkStats, getGetNetworkStatsQueryKey,
  useGetEconomyStats, getGetEconomyStatsQueryKey,
  useGetRecentActivity, getGetRecentActivityQueryKey
} from "@workspace/api-client-react";
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
      {/* ── Page heading ── */}
      <div className="flex flex-col gap-1.5 pb-2" style={{ borderBottom: "1px solid hsl(var(--primary)/0.15)" }}>
        <h1
          style={{
            fontFamily: "'Cinzel', serif",
            fontSize: "clamp(18px, 3vw, 26px)",
            letterSpacing: "0.25em",
            fontWeight: 700,
            color: "hsl(var(--primary))",
          }}
        >
          NETWORK OVERVIEW
        </h1>
        <p
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontStyle: "italic",
            fontSize: "15px",
            color: "hsl(var(--muted-foreground))",
            opacity: 0.9,
          }}
        >
          Live telemetry from the Solana decentralised storage economy.
        </p>
      </div>

      {/* ── Primary stat cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Total Storage"
          value={network?.totalStorageTb !== undefined ? `${network.totalStorageTb.toFixed(2)} TB` : undefined}
          subtitle={network?.networkUtilizationPercent !== undefined ? `${network.networkUtilizationPercent.toFixed(1)}% Utilised` : undefined}
          icon={HardDrive}
          loading={networkLoading}
        />
        <StatCard 
          title="Active Deals"
          value={network?.activeDeals !== undefined ? String(network.activeDeals) : undefined}
          subtitle={network?.totalDealsAllTime !== undefined ? `${network.totalDealsAllTime} All Time` : undefined}
          icon={Database}
          loading={networkLoading}
        />
        <StatCard 
          title="SOL Locked"
          value={network?.totalSolLocked !== undefined ? `◎ ${network.totalSolLocked.toLocaleString()}` : undefined}
          subtitle="In Active Escrow"
          icon={Coins}
          loading={networkLoading}
        />
        <StatCard 
          title="Avg Market Price"
          value={economy?.solPerGbPerEpoch ? `◎ ${economy.solPerGbPerEpoch.toFixed(4)}` : undefined}
          subtitle="per GB / Epoch"
          icon={Activity}
          loading={economyLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Charts ── */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card/60 backdrop-blur-sm border-primary/15">
            <CardHeader>
              <CardTitle
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: "10px",
                  letterSpacing: "0.22em",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                MARKET PRICE HISTORY (SOL/GB/EPOCH)
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
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--primary)/0.1)" vertical={false} />
                      <XAxis 
                        dataKey="epoch" 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={10}
                        fontFamily="'DM Mono', monospace"
                        tickFormatter={(val) => `Ep ${val}`}
                      />
                      <YAxis 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={10}
                        fontFamily="'DM Mono', monospace"
                        tickFormatter={(val) => `${val} SOL`}
                      />
                      <RechartsTooltip 
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--primary)/0.3)",
                          color: "hsl(var(--foreground))",
                          fontFamily: "'DM Mono', monospace",
                          fontSize: "11px",
                          borderRadius: "2px",
                        }}
                        labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="priceSol" 
                        stroke="hsl(var(--primary))" 
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 5, fill: "hsl(var(--primary))" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-card/60 backdrop-blur-sm border-primary/15">
              <CardHeader>
                <CardTitle
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "10px",
                    letterSpacing: "0.22em",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  STORAGE BY REGION
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
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--primary)/0.1)" vertical={false} />
                        <XAxis 
                          dataKey="region" 
                          stroke="hsl(var(--muted-foreground))" 
                          fontSize={10}
                          fontFamily="'DM Mono', monospace"
                        />
                        <RechartsTooltip 
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            borderColor: "hsl(var(--primary)/0.3)",
                            color: "hsl(var(--foreground))",
                            fontFamily: "'DM Mono', monospace",
                            fontSize: "11px",
                            borderRadius: "2px",
                          }}
                          cursor={{ fill: "hsl(var(--primary)/0.06)" }}
                        />
                        <Bar 
                          dataKey="totalStorageTb" 
                          fill="hsl(var(--primary))" 
                          radius={[1, 1, 0, 0]}
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
                value={network?.activeProviders !== undefined ? String(network.activeProviders) : undefined}
                subtitle={network?.totalProviders !== undefined ? `Out of ${network.totalProviders} total` : undefined}
                icon={ServerCog}
                loading={networkLoading}
              />
              <StatCard 
                title="Avg Reputation"
                value={network?.avgReputationScore !== undefined ? `${network.avgReputationScore.toFixed(1)} / 100` : undefined}
                subtitle="Network Wide"
                icon={Shield}
                loading={networkLoading}
              />
            </div>
          </div>
        </div>

        {/* ── Activity feed ── */}
        <Card className="bg-card/60 backdrop-blur-sm border-primary/15 h-[calc(100vh-12rem)] min-h-[600px] flex flex-col">
          <CardHeader className="border-b border-primary/10 pb-4">
            <CardTitle
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: "10px",
                letterSpacing: "0.22em",
                color: "hsl(var(--muted-foreground))",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Activity className="size-3.5" />
              NETWORK EVENTS
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-0">
            {activityLoading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="flex gap-4">
                    <Skeleton className="size-8 rounded-sm bg-primary/10" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-full bg-primary/10" />
                      <Skeleton className="h-3 w-24 bg-primary/10" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-primary/10">
                {Array.isArray(activity) && activity.length > 0 ? (
                  activity.map((event) => {
                    let Icon = Clock;
                    let iconColor = "hsl(var(--muted-foreground))";
                    
                    if (event.type === "deal_created")   { Icon = ArrowRightLeft; iconColor = "hsl(var(--chart-2))"; }
                    else if (event.type === "deal_activated") { Icon = Database;  iconColor = "hsl(var(--primary))"; }
                    else if (event.type === "deal_completed") { Icon = CheckCircle2; iconColor = "hsl(var(--chart-4))"; }
                    else if (event.type === "provider_joined") { Icon = UserPlus; iconColor = "hsl(var(--chart-3))"; }
                    else if (event.type === "provider_updated") { Icon = ServerCog; iconColor = "hsl(var(--muted-foreground))"; }

                    return (
                      <div key={event.id} className="p-4 hover:bg-primary/5 transition-colors flex gap-4">
                        <div
                          className="mt-0.5 p-1.5 rounded-sm bg-background border border-primary/15"
                          style={{ color: iconColor }}
                        >
                          <Icon className="size-4" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <p
                            style={{
                              fontFamily: "'DM Mono', monospace",
                              fontSize: "11px",
                              color: "hsl(var(--foreground))",
                              lineHeight: 1.5,
                            }}
                          >
                            {event.description}
                          </p>
                          <p
                            style={{
                              fontFamily: "'DM Mono', monospace",
                              fontSize: "9px",
                              color: "hsl(var(--muted-foreground))",
                              letterSpacing: "0.05em",
                            }}
                          >
                            {format(new Date(event.timestamp), "MMM d, HH:mm:ss")}
                          </p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground font-mono">
                    NO RECENT EVENT DATA AVAILABLE
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
