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
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold font-mono tracking-tight text-primary-foreground">Storage Deals</h1>
          <p className="text-muted-foreground font-mono">
            {isLoading ? "Loading..." : `${filtered?.length ?? 0} deals`}
          </p>
        </div>
        <Link href="/deals/new">
          <Button className="font-mono gap-2">
            <Plus className="size-4" /> New Deal
          </Button>
        </Link>
      </div>

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

      <div className="space-y-2">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full bg-primary/10 rounded-md" />
            ))
          : filtered?.map((deal) => (
              <Link key={deal.id} href={`/deals/${deal.id}`}>
                <Card className="bg-card/50 border-primary/20 hover:border-primary/50 hover:bg-card/80 transition-all cursor-pointer group">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="p-2 rounded-sm bg-background border border-border/50">
                          <Database className="size-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-xs text-muted-foreground">#{deal.id}</span>
                            <span className="font-mono font-bold text-primary-foreground">{deal.providerName}</span>
                            <Badge variant={statusColors[deal.status] ?? "outline"} className="font-mono text-xs">
                              {deal.status}
                            </Badge>
                          </div>
                          <p className="text-xs font-mono text-muted-foreground truncate">{deal.clientAddress}</p>
                        </div>
                      </div>

                      <div className="hidden md:flex items-center gap-8 shrink-0">
                        <div className="text-right">
                          <p className="text-xs font-mono text-muted-foreground uppercase">Size</p>
                          <p className="font-mono font-semibold text-primary-foreground text-sm">{deal.storageGb} GB</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-mono text-muted-foreground uppercase">Duration</p>
                          <p className="font-mono font-semibold text-primary-foreground text-sm">{deal.durationEpochs} epochs</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-mono text-muted-foreground uppercase">Total Cost</p>
                          <p className="font-mono font-semibold text-primary text-sm">₳ {deal.totalCostAda.toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-mono text-muted-foreground uppercase">Created</p>
                          <p className="font-mono text-sm text-primary-foreground">
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
