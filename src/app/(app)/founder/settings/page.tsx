import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PlatformSettingForm } from "@/components/founder/platform-setting-form";
import { requireFounder } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";

export const metadata = { title: "Founder settings" };

async function SettingsContent() {
  await connection();
  await requireFounder();
  const backend = await getBackend();
  const settings = await backend.data.getPlatformSettings();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Founder settings</h1>
        <p className="text-sm text-muted-foreground">
          These values are shown to every company on their billing page.{" "}
          <Link href="/account/password" className="underline underline-offset-4">
            Change your own password
          </Link>
          .
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment instructions</CardTitle>
          <CardDescription>Shown on every company&apos;s billing page.</CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <PlatformSettingForm settingKey="payment_instructions" defaultValue={settings.payment_instructions ?? ""} placeholder="e.g. Transfer to Account ... and quote your reference." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Support email</CardTitle>
        </CardHeader>
        <CardContent className="pb-6">
          <PlatformSettingForm settingKey="support_email" defaultValue={settings.support_email ?? ""} placeholder="support@example.com" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan price text</CardTitle>
          <CardDescription>Free-text description shown wherever pricing is mentioned.</CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <PlatformSettingForm settingKey="plan_price_text" defaultValue={settings.plan_price_text ?? ""} placeholder="e.g. $49/month after your 30-day trial." />
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export default function FounderSettingsPage() {
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsContent />
    </Suspense>
  );
}
