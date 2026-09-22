import { useState } from "react";
import { useListDeals, getListDealsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, Search, Plus, ArrowRight } from "lucide-react";
import { format } from "date-fns";

const statusColors: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  completed: "secondary",
  pending: "outline",
  failed: "destructive",
};

export default function Deals() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: deals, isLoading } = useListDeals(
    { status: statusFilter as any },
    { query: { queryKey: getListDealsQueryKey({ status: statusFilter as any }) } }
  );

  const filtered = deals?.filter((d) =>
    d.providerName.toLowerCase().includes(search.toLowerCase()) ||
    d.clientAddress.toLowerCase().includes(search.toLowerCase()) ||
    d.dataHash.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Heading ── */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1.5 pb-2" style={{ borderBottom: "1px solid hsl(var(--primary)/0.15)", flex: 1, marginRight: "16px" }}>
          <h1
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: "clamp(18px, 3vw, 26px)",
              letterSpacing: "0.25em",
              fontWeight: 700,
              color: "hsl(var(--primary))",
            }}
          >
            STORAGE DEALS
          </h1>
          <p
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontStyle: "italic",
              fontSize: "15px",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            {isLoading ? "Loading..." : `${filtered?.length ?? 0} deals recorded`}
          </p>
        </div>
        <Link href="/deals/new">
          <Button
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: "10px",
              letterSpacing: "0.25em",
            }}
            className="gap-2"
          >
            <Plus className="size-3.5" /> NEW DEAL
          </Button>
        </Link>
      </div>

      {/* ── Filters ── */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by provider, client address, or data hash..."
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
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Deal list ── */}
      <div className="space-y-2">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full bg-primary/10 rounded-sm" />
            ))
          : filtered?.map((deal) => (
              <Link key={deal.id} href={`/deals/${deal.id}`}>
                <Card className="bg-card/60 border-primary/15 hover:border-primary/40 hover:bg-card/80 transition-all cursor-pointer group">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="p-2 rounded-sm bg-background border border-primary/15">
                          <Database className="size-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>
                              #{deal.id}
                            </span>
                            <span
                              style={{
                                fontFamily: "'Cinzel', serif",
                                fontSize: "13px",
                                letterSpacing: "0.08em",
                                color: "hsl(var(--foreground))",
                                fontWeight: 600,
                              }}
                            >
                              {deal.providerName}
                            </span>
                            <Badge variant={statusColors[deal.status] ?? "outline"} className="font-mono text-xs">
                              {deal.status}
                            </Badge>
                          </div>
                          <p
                            style={{
                              fontFamily: "'DM Mono', monospace",
                              fontSize: "10px",
                              color: "hsl(var(--muted-foreground))",
                              letterSpacing: "0.04em",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {deal.clientAddress}
                          </p>
                        </div>
                      </div>

                      <div className="hidden md:flex items-center gap-8 shrink-0">
                        <div className="text-right">
                          <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", letterSpacing: "0.18em", color: "hsl(var(--muted-foreground))" }}>SIZE</p>
                          <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "12px", color: "hsl(var(--foreground))", fontWeight: 500 }}>{deal.storageGb} GB</p>
                        </div>
                        <div className="text-right">
                          <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", letterSpacing: "0.18em", color: "hsl(var(--muted-foreground))" }}>DURATION</p>
                          <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "12px", color: "hsl(var(--foreground))", fontWeight: 500 }}>{deal.durationEpochs} epochs</p>
                        </div>
                        <div className="text-right">
                          <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", letterSpacing: "0.18em", color: "hsl(var(--muted-foreground))" }}>TOTAL COST</p>
                          <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "12px", color: "hsl(var(--primary))", fontWeight: 500 }}>◎ {deal.totalCostAda.toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                          <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "9px", letterSpacing: "0.18em", color: "hsl(var(--muted-foreground))" }}>CREATED</p>
                          <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "12px", color: "hsl(var(--foreground))" }}>
                            {format(new Date(deal.createdAt), "MMM d")}
                          </p>
                        </div>
                        <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
      </div>
    </div>
  );
}
