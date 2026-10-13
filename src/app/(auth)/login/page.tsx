import Link from "next/link";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "@/lib/auth/validation";

export const metadata = { title: "Sign in" };

// searchParams is request-time data, so it is read behind a Suspense boundary
// (Cache Components) while the card chrome stays in the static shell.
async function LoginFormWithParams({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNextPath(params.next, "") : "";
  const confirmationFailed = params.error === "confirmation";

  return (
    <>
      {confirmationFailed ? (
        <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          That confirmation link is invalid or has expired. Sign in, or register again to get a new link.
        </p>
      ) : null}
      <LoginForm next={next || undefined} />
    </>
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Use the email and password for your account.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pb-6">
        <Suspense fallback={<div className="h-48 animate-pulse rounded-md bg-muted" aria-hidden />}>
          <LoginFormWithParams searchParams={searchParams} />
        </Suspense>
        <p className="text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/register" className="font-medium text-foreground underline underline-offset-4">
            Start your free trial
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
