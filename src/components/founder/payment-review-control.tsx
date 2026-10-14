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
import { reviewPayment } from "@/lib/founder/actions";

export function PaymentReviewControl({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function act(decision: "approve" | "reject") {
    setBusy(true);
    const result = await reviewPayment(paymentId, decision, note || undefined);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(decision === "approve" ? "Payment approved." : "Payment rejected.");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="accent" disabled={busy} onClick={() => act("approve")}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Approve
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={busy}>
            Reject
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this payment?</AlertDialogTitle>
            <AlertDialogDescription>A reason is required and will be shown to the company.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea placeholder="Reason for rejection" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={!note.trim()} onClick={() => act("reject")}>
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
