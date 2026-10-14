"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setSubscription } from "@/lib/founder/actions";

type Status = "trialing" | "past_due" | "canceled";

export function SubscriptionControl({ companyId, trialEndsAt }: { companyId: string; trialEndsAt: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("trialing");
  const [date, setDate] = useState(trialEndsAt ? trialEndsAt.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    const result = await setSubscription(companyId, status, status === "trialing" && date ? new Date(date).toISOString() : undefined);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Subscription updated.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Only an approved payment can set a subscription to <strong>active</strong>. Use this to put a company back on a
        trial, mark it past-due, or cancel it.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sub-status">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
            <SelectTrigger id="sub-status" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trialing">Trialing</SelectItem>
              <SelectItem value="past_due">Past due</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {status === "trialing" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="trial-end">Trial ends</Label>
            <Input id="trial-end" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        ) : null}
        <Button onClick={apply} disabled={busy} variant="outline">
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Apply
        </Button>
      </div>
    </div>
  );
}
