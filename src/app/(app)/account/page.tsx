import Link from "next/link";
import { Suspense } from "react";

import { ProfileForm } from "@/components/account/profile-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthUser, requireUser } from "@/lib/auth/dal";

export const metadata = { title: "Account settings" };

async function AccountContent() {
  await requireUser();
  const user = await getAuthUser();

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Account settings</CardTitle>
          <CardDescription>{user?.email}</CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <ProfileForm defaultName={user?.fullName ?? ""} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
        </CardHeader>
        <CardContent className="pb-6">
          <Button asChild variant="outline">
            <Link href="/account/password">Change password</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-72 max-w-md animate-pulse rounded-xl bg-muted" aria-hidden />}>
      <AccountContent />
    </Suspense>
  );
}
