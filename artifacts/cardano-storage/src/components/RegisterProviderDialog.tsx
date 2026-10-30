import { useState, type FormEvent } from "react";
import {
  getListProvidersQueryKey,
  useCreateProvider,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@/contexts/WalletContext";
import { Loader2 } from "lucide-react";

/**
 * libp2p peer ids are base58 and at least 10 characters (see `peerId` in
 * `@workspace/api-zod`). Mirrored here only to keep an obvious typo from
 * round-tripping to a 400; the server remains the authority.
 */
const PEER_ID_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{10,128}$/;

const EMPTY_FORM = {
  name: "",
  region: "",
  nodeId: "",
  totalStorageGb: "",
  pricePerGbPerEpoch: "",
  peerId: "",
};

export interface RegisterProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The provider registration form, as a self-contained dialog.
 *
 * It owns its own form state and mutation so both call sites — the Providers
 * page and the "Become a Provider" onboarding page — share one implementation
 * rather than keeping two copies of the validation and the wallet wiring in
 * sync. The parent only controls visibility.
 *
 * `useWallet` is what makes the bearer token attach: `WalletContext` registers
 * the auth-token getter with the API client, so `useCreateProvider`'s POST
 * carries the wallet-signed session automatically. `connected` also gates the
 * submit, since an unauthenticated POST would just be a 401.
 */
export function RegisterProviderDialog({
  open,
  onOpenChange,
}: RegisterProviderDialogProps) {
  const [form, setForm] = useState(EMPTY_FORM);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { connected, address } = useWallet();
  const createProvider = useCreateProvider();

  const setField = (key: keyof typeof EMPTY_FORM, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const totalStorageGb = parseFloat(form.totalStorageGb);
  const pricePerGbPerEpoch = parseFloat(form.pricePerGbPerEpoch);
  const peerId = form.peerId.trim();
  const peerIdValid = peerId === "" || PEER_ID_PATTERN.test(peerId);

  const canSubmit =
    connected &&
    form.name.trim().length >= 2 &&
    form.nodeId.trim().length >= 1 &&
    form.region.trim().length >= 1 &&
    Number.isFinite(totalStorageGb) &&
    totalStorageGb > 0 &&
    Number.isFinite(pricePerGbPerEpoch) &&
    pricePerGbPerEpoch > 0 &&
    peerIdValid &&
    !createProvider.isPending;

  const closeDialog = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setForm(EMPTY_FORM);
      createProvider.reset();
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    createProvider.mutate(
      {
        data: {
          name: form.name.trim(),
          nodeId: form.nodeId.trim(),
          region: form.region.trim(),
          totalStorageGb,
          pricePerGbPerEpoch,
          // Omit entirely when blank: an empty string fails the peerId regex,
          // while an absent field keeps the provider on the Pinata path.
          ...(peerId ? { peerId } : {}),
        },
      },
      {
        onSuccess: (provider) => {
          // Prefix match: the list query's key carries the status filter, and
          // `invalidateQueries` matches by prefix, so the bare key still
          // refreshes whatever filter is active.
          queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
          toast({
            title: "Provider registered",
            description: `${provider.name} is now listed on the network.`,
          });
          closeDialog(false);
        },
      }
    );
  };

  const errorMessage =
    createProvider.error instanceof Error ? createProvider.error.message : null;

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="max-w-lg bg-card border-primary/20" data-testid="register-provider-dialog">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider text-primary">
            Register Provider
          </DialogTitle>
          <DialogDescription className="font-mono text-xs text-muted-foreground">
            {connected
              ? "Your connected wallet becomes the provider's owner — the server binds it from the signed session, not this form."
              : "Connect a wallet first; registration is signed and only a signed wallet can register a provider."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase text-muted-foreground">Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="ProStorage Alpha"
              className="font-mono bg-background/50 border-primary/20"
              data-testid="register-provider-name"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Region</Label>
              <Input
                value={form.region}
                onChange={(e) => setField("region", e.target.value)}
                placeholder="us-east"
                className="font-mono bg-background/50 border-primary/20"
                data-testid="register-provider-region"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Node ID</Label>
              <Input
                value={form.nodeId}
                onChange={(e) => setField("nodeId", e.target.value)}
                placeholder="pool1abc123"
                className="font-mono bg-background/50 border-primary/20"
                data-testid="register-provider-nodeid"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Total Storage (GB)</Label>
              <Input
                type="number"
                min="1"
                value={form.totalStorageGb}
                onChange={(e) => setField("totalStorageGb", e.target.value)}
                placeholder="500"
                className="font-mono bg-background/50 border-primary/20"
                data-testid="register-provider-totalstorage"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Price (SOL / GB / epoch)</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={form.pricePerGbPerEpoch}
                onChange={(e) => setField("pricePerGbPerEpoch", e.target.value)}
                placeholder="2.5"
                className="font-mono bg-background/50 border-primary/20"
                data-testid="register-provider-price"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase text-muted-foreground">
              Peer ID <span className="normal-case text-muted-foreground/70">(optional)</span>
            </Label>
            <Input
              value={form.peerId}
              onChange={(e) => setField("peerId", e.target.value)}
              placeholder="12D3KooW… — leave blank for the Pinata path"
              className="font-mono bg-background/50 border-primary/20 text-sm"
              data-testid="register-provider-peerid"
            />
            {!peerIdValid && (
              <p className="font-mono text-xs text-destructive">
                Peer ID must be a base58 libp2p peer id (10–128 chars).
              </p>
            )}
          </div>

          {address && (
            <p className="font-mono text-[10px] text-muted-foreground break-all">
              OWNER WALLET {address}
            </p>
          )}

          {errorMessage && (
            <p className="font-mono text-xs text-destructive text-center break-all">
              {errorMessage}
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              className="font-mono"
              onClick={() => closeDialog(false)}
              disabled={createProvider.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="font-mono gap-2"
              disabled={!canSubmit}
              data-testid="register-provider-submit"
            >
              {createProvider.isPending ? (
                <><Loader2 className="size-4 animate-spin" /> Registering...</>
              ) : (
                "Register Provider"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
