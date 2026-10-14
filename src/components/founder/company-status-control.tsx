"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { setCompanyStatus } from "@/lib/founder/actions";

export function CompanyStatusControl({ companyId, status }: { companyId: string; status: "active" | "suspended" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const next = status === "active" ? "suspended" : "active";

  async function confirm() {
    setBusy(true);
    const result = await setCompanyStatus(companyId, next, next === "suspended" ? reason : undefined);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Company ${next === "suspended" ? "suspended" : "re-activated"}.`);
    router.refresh();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={status === "active" ? "destructive" : "accent"} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {status === "active" ? "Suspend company" : "Re-activate company"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{status === "active" ? "Suspend this company?" : "Re-activate this company?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {status === "active"
              ? "Every member immediately loses all access to the company's data until it is re-activated."
              : "Access returns according to the company's current subscription state (trial, active, read-only)."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {status === "active" ? (
          <Textarea placeholder="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={status === "active" ? "destructive" : "accent"} onClick={confirm}>
            {status === "active" ? "Suspend" : "Re-activate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
