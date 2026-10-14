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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Member } from "@/lib/backend/types";
import { setMemberRole, setMemberStatus } from "@/lib/employees/actions";

export function MemberRoleControl({ member, disabled }: { member: Member; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(role: string) {
    if (role === member.role) return;
    setBusy(true);
    const result = await setMemberRole(member.id, role as "admin" | "employee");
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`${member.fullName ?? member.email} is now ${role}.`);
    router.refresh();
  }

  return (
    <Select value={member.role} onValueChange={change} disabled={disabled || busy}>
      <SelectTrigger size="sm" className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="employee">Employee</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function MemberStatusControl({ member, disabled }: { member: Member; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const nextStatus = member.status === "active" ? "disabled" : "active";

  async function confirm() {
    setBusy(true);
    const result = await setMemberStatus(member.id, nextStatus);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`${member.fullName ?? member.email} is now ${nextStatus}.`);
    router.refresh();
  }

  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {member.status === "active" ? "Active" : "Disabled"}
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={member.status === "active" ? "outline" : "secondary"} size="sm" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {member.status === "active" ? "Active" : "Disabled"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{nextStatus === "disabled" ? "Disable" : "Re-enable"} {member.fullName ?? member.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            {nextStatus === "disabled"
              ? "They will immediately lose access to the company's data until re-enabled."
              : "They will regain access according to their existing table permissions."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={nextStatus === "disabled" ? "destructive" : "accent"} onClick={confirm}>
            {nextStatus === "disabled" ? "Disable" : "Re-enable"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
