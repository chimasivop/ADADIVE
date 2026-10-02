import { useState } from "react";
import { useCreateDeal, useListProviders, getListProvidersQueryKey, getListDealsQueryKey } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Database, Loader2 } from "lucide-react";
import { useWallet } from "@/contexts/WalletContext";

export default function NewDeal() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { address, connected } = useWallet();

  const [providerId, setProviderId] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [storageGb, setStorageGb] = useState("");
  const [durationEpochs, setDurationEpochs] = useState("");
  const [dataHash, setDataHash] = useState("");

  const { data: providers } = useListProviders(
    { status: "active" },
    { query: { queryKey: getListProvidersQueryKey({ status: "active" }) } }
  );

  const selectedProvider = providers?.find((p) => p.id === parseInt(providerId, 10));
  const estimatedCost =
    selectedProvider && storageGb && durationEpochs
      ? (parseFloat(storageGb) * parseInt(durationEpochs, 10) * selectedProvider.pricePerGbPerEpoch).toFixed(4)
      : null;

  const createDeal = useCreateDeal();

  // The deal's client address is the wallet that owns it, and the api-server
  // now enforces that `clientAddress` equals the authenticated wallet. Offer the
  // connected address so the common path cannot be a 403 by typo.
  const effectiveClientAddress = clientAddress || address || "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerId || !effectiveClientAddress || !storageGb || !durationEpochs || !dataHash) return;

    createDeal.mutate(
      {
        data: {
          providerId: parseInt(providerId, 10),
          clientAddress: effectiveClientAddress,
          storageGb: parseFloat(storageGb),
          durationEpochs: parseInt(durationEpochs, 10),
          dataHash,
        },
      },
      {
        onSuccess: (deal) => {
          queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
          navigate(`/deals/${deal.id}`);
        },
      }
    );
  };

  const errorMessage =
    createDeal.error instanceof Error ? createDeal.error.message : null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link href="/deals">
          <button className="flex items-center gap-2 text-muted-foreground hover:text-primary font-mono text-sm transition-colors">
            <ArrowLeft className="size-4" /> Deals
          </button>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="p-2 rounded-sm bg-card border border-border/50">
          <Database className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold font-mono tracking-tight text-primary-foreground">Propose Deal</h1>
          <p className="text-muted-foreground font-mono text-sm">Submit a new storage deal to the network</p>
        </div>
      </div>

      <Card className="bg-card/50 border-primary/20">
        <CardHeader>
          <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground">Deal Parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Storage Provider</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger className="font-mono bg-background/50 border-primary/20">
                  <SelectValue placeholder="Select a provider..." />
                </SelectTrigger>
                <SelectContent>
                  {providers?.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)} className="font-mono">
                      {p.name} — {p.pricePerGbPerEpoch.toFixed(5)} SOL/GB/epoch — {p.region}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Client Wallet Address</Label>
              <Input
                value={effectiveClientAddress}
                onChange={(e) => setClientAddress(e.target.value)}
                placeholder={connected ? address ?? "base58 public key…" : "connect a wallet to fill this"}
                className="font-mono bg-background/50 border-primary/20 text-sm"
              />
              <p className="font-mono text-xs text-muted-foreground">
                {connected
                  ? "Defaults to your connected wallet — a deal can only be created for its owner."
                  : "Connect a wallet first; the server requires the deal's client to be the authenticated wallet."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Storage (GB)</Label>
                <Input
                  type="number"
                  min="1"
                  value={storageGb}
                  onChange={(e) => setStorageGb(e.target.value)}
                  placeholder="256"
                  className="font-mono bg-background/50 border-primary/20"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Duration (Epochs)</Label>
                <Input
                  type="number"
                  min="1"
                  value={durationEpochs}
                  onChange={(e) => setDurationEpochs(e.target.value)}
                  placeholder="120"
                  className="font-mono bg-background/50 border-primary/20"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Data Hash</Label>
              <Input
                value={dataHash}
                onChange={(e) => setDataHash(e.target.value)}
                placeholder="sha256:..."
                className="font-mono bg-background/50 border-primary/20 text-sm"
              />
            </div>

            {estimatedCost && (
              <div className="p-4 bg-background/50 rounded border border-primary/30">
                <p className="font-mono text-xs text-muted-foreground uppercase mb-1">Estimated Total Cost</p>
                <p className="font-mono text-2xl font-bold text-primary">{estimatedCost} SOL</p>
                <p className="font-mono text-xs text-muted-foreground mt-1">
                  {storageGb} GB × {durationEpochs} epochs × {selectedProvider?.pricePerGbPerEpoch.toFixed(6)} SOL/GB/epoch
                </p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full font-mono gap-2"
              disabled={createDeal.isPending || !providerId || !effectiveClientAddress || !storageGb || !durationEpochs || !dataHash}
            >
              {createDeal.isPending ? (
                <><Loader2 className="size-4 animate-spin" /> Submitting...</>
              ) : (
                "Submit Deal"
              )}
            </Button>

            {errorMessage && (
              <p className="font-mono text-xs text-destructive text-center break-all">
                {errorMessage}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
