import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSupabaseConfig } from "@/lib/supabase/config";

type CheckStatus = "ok" | "missing" | "error";

interface CheckResult {
  label: string;
  status: CheckStatus;
  detail: string;
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const guard = getSupabaseConfig();
  results.push({
    label: "Environment guard (which Supabase project this deployment may use)",
    status: guard.ok ? "ok" : "error",
    detail: guard.ok
      ? `Accepted for the "${guard.environment}" environment.`
      : `Rejected: ${guard.reason}`,
  });

  results.push({
    label: "NEXT_PUBLIC_SUPABASE_URL",
    status: url ? "ok" : "missing",
    detail: url ? "Set." : "Not set — copy .env.example to .env.local and fill it in.",
  });

  results.push({
    label: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    status: anonKey ? "ok" : "missing",
    detail: anonKey ? "Set." : "Not set — copy .env.example to .env.local and fill it in.",
  });

  results.push({
    label: "SUPABASE_SERVICE_ROLE_KEY (server-only)",
    status: serviceKey ? "ok" : "missing",
    detail: serviceKey
      ? "Set (server-side only — never exposed to the browser)."
      : "Not set — required for founder-provisioning and other admin actions.",
  });

  if (guard.ok && url && anonKey) {
    try {
      const res = await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: anonKey },
        cache: "no-store",
      });
      results.push({
        label: "Supabase Auth reachable",
        status: res.ok ? "ok" : "error",
        detail: res.ok
          ? "Responded successfully."
          : `Responded with HTTP ${res.status}.`,
      });
    } catch (err) {
      results.push({
        label: "Supabase Auth reachable",
        status: "error",
        detail: err instanceof Error ? err.message : "Request failed.",
      });
    }
  } else {
    results.push({
      label: "Supabase Auth reachable",
      status: "missing",
      detail: "Skipped — Supabase configuration is missing or rejected by the environment guard.",
    });
  }

  return results;
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "ok") return <CheckCircle2 className="text-accent" />;
  if (status === "missing") return <AlertTriangle className="text-muted-foreground" />;
  return <XCircle className="text-destructive" />;
}

async function SetupContent() {
  // Evaluate the CURRENT runtime environment, never a build-time snapshot.
  await connection();
  // Diagnostics are for development and previews only.
  if (process.env.VERCEL_ENV === "production") notFound();

  const checks = await runChecks();
  const allOk = checks.every((c) => c.status === "ok");

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Environment setup check</h1>
        <Badge variant={allOk ? "accent" : "secondary"}>
          {allOk ? "All checks passed" : "Setup incomplete"}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration status</CardTitle>
          <CardDescription>
            This page reads only whether required variables are set — never their values.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <ul className="flex flex-col gap-4">
            {checks.map((check) => (
              <li key={check.label} className="flex items-start gap-3">
                <span className="mt-0.5 size-5 shrink-0">
                  <StatusIcon status={check.status} />
                </span>
                <div>
                  <p className="text-sm font-medium">{check.label}</p>
                  <p className="text-sm text-muted-foreground">{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-64 max-w-2xl animate-pulse rounded-xl bg-muted" aria-hidden />}>
      <SetupContent />
    </Suspense>
  );
}
