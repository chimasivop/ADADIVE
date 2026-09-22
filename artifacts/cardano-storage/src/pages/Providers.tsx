import { useState } from "react";
import { useListProviders, getListProvidersQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { HardDrive, Search, ArrowRight, Shield, Globe } from "lucide-react";

export default function Providers() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: providers, isLoading } = useListProviders(
    { status: statusFilter as "active" | "inactive" | "all" },
    { query: { queryKey: getListProvidersQueryKey({ status: statusFilter as any }) } }
  );

  const filtered = providers?.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.region.toLowerCase().includes(search.toLowerCase()) ||
    p.nodeId.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Heading ── */}
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
          STORAGE PROVIDERS
        </h1>
        <p
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontStyle: "italic",
            fontSize: "15px",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          {isLoading ? "Loading..." : `${filtered?.length ?? 0} providers on the network`}
        </p>
      </div>

      {/* ── Filters ── */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, region, node ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 font-mono bg-card/50 border-primary/20"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 font-mono bg-card/50 border-primary/20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Provider list ── */}
      <div className="space-y-2">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full bg-primary/10 rounded-sm" />
            ))
          : filtered?.map((provider) => {
              const utilization = provider.totalStorageGb > 0
                ? (provider.usedStorageGb / provider.totalStorageGb) * 100
                : 0;
              return (
                <Link key={provider.id} href={`/providers/${provider.id}`}>
                  <Card className="bg-card/60 border-primary/15 hover:border-primary/40 hover:bg-card/80 transition-all cursor-pointer group">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="p-2 rounded-sm bg-background border border-primary/15">
                            <HardDrive className="size-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span
                                style={{
                                  fontFamily: "'Cinzel', serif",
                                  fontSize: "13px",
                                  letterSpacing: "0.1em",
                                  color: "hsl(var(--foreground))",
                                  fontWeight: 600,
                                }}
                              >
                                {provider.name}
                              </span>
                              <Badge
                                variant={provider.status === "active" ? "default" : "secondary"}
                                className="font-mono text-xs"
                              >
                                {provider.status}
                              </Badge>
                            </div>
                            <p
                              style={{
                                fontFamily: "'DM Mono', monospace",
                                fontSize: "10px",
                                color: "hsl(var(--muted-foreground))",
                                letterSpacing: "0.05em",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {provider.nodeId}
                            </p>
                          </div>
                        </div>

                        <div className="hidden md:flex items-center gap-8 shrink-0 text-right">
                          <div>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", letterSpacing: "0.18em", color: "hsl(var(--muted-foreground))" }}>STORAGE</p>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "12px", color: "hsl(var(--foreground))", fontWeight: 500 }}>
                              {(provider.usedStorageGb / 1024).toFixed(1)} / {(provider.totalStorageGb / 1024).toFixed(1)} TB
                            </p>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", color: "hsl(var(--muted-foreground))" }}>{utilization.toFixed(1)}% used</p>
                          </div>
                          <div>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", letterSpacing: "0.18em", color: "hsl(var(--muted-foreground))" }}>PRICE</p>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "12px", color: "hsl(var(--primary))", fontWeight: 500 }}>
                              ◎ {provider.pricePerGbPerEpoch.toFixed(5)}
                            </p>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", color: "hsl(var(--muted-foreground))" }}>per GB/epoch</p>
                          </div>
                          <div>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", letterSpacing: "0.18em", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: "3px", justifyContent: "flex-end" }}>
                              <Globe className="size-3" /> REGION
                            </p>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "12px", color: "hsl(var(--foreground))", fontWeight: 500 }}>{provider.region}</p>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", color: "hsl(var(--muted-foreground))" }}>{provider.uptimePercent?.toFixed(1)}% uptime</p>
                          </div>
                          <div>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", letterSpacing: "0.18em", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: "3px", justifyContent: "flex-end" }}>
                              <Shield className="size-3" /> REP
                            </p>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "12px", color: "hsl(var(--foreground))", fontWeight: 500 }}>{provider.reputationScore.toFixed(1)}</p>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", color: "hsl(var(--muted-foreground))" }}>/ 100</p>
                          </div>
                          <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </div>

                      <div className="mt-3 h-px bg-primary/8 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${Math.min(utilization, 100)}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
      </div>
    </div>
  );
}
