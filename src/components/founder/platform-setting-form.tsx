"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SettingKey } from "@/lib/backend/types";
import { updatePlatformSetting } from "@/lib/founder/actions";

export function PlatformSettingForm({ settingKey, defaultValue, placeholder }: { settingKey: SettingKey; defaultValue: string; placeholder: string }) {
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const result = await updatePlatformSetting(settingKey, value);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Saved.");
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} rows={settingKey === "payment_instructions" ? 4 : 2} maxLength={4000} />
      <Button onClick={save} disabled={busy} variant="outline" className="self-start">
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Save
      </Button>
    </div>
  );
}
