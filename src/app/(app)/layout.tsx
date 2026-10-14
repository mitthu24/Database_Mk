import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Table2 } from "lucide-react";

import { MobileNav, type NavLink } from "@/components/app/mobile-nav";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { getAuthUser, requireContext } from "@/lib/auth/dal";

// The session is read inside AppFrame, behind a Suspense boundary, so the page
// shell can stream immediately (Cache Components). Each page ALSO verifies the
// session through the DAL; this frame is not the security boundary.
async function AppFrame({ children }: { children: React.ReactNode }) {
  await connection();
  const ctx = await requireContext();
  const user = await getAuthUser();

  const links: NavLink[] = [
    { href: "/dashboard", label: "Dashboard" },
    ...(ctx.isFounder ? [{ href: "/founder", label: "Founder" }] : []),
    ...(!ctx.isFounder && ctx.companyId
      ? [
          { href: "/tables", label: "Tables" },
          ...(ctx.role === "admin" ? [{ href: "/employees", label: "Employees" }] : []),
          { href: "/company", label: "Company" },
          { href: "/company/billing", label: "Billing" },
        ]
      : []),
    { href: "/account", label: "Account" },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="relative border-b bg-card">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold" aria-label="Tabular Data Management, go to dashboard">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Table2 className="size-4" aria-hidden />
            </span>
            <span className="hidden sm:inline" aria-hidden>Tabular Data Management</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
            {links.map((l) => (
              <Button key={l.href} asChild variant="ghost" size="sm">
                <Link href={l.href}>{l.label}</Link>
              </Button>
            ))}
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm" title={user?.email ?? undefined}>
                Sign out
              </Button>
            </form>
          </nav>
          <MobileNav links={links} email={user?.email ?? null} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          <div className="h-8 w-48 animate-pulse rounded-md bg-muted" aria-hidden />
          <span className="sr-only">Loading…</span>
        </div>
      }
    >
      <AppFrame>{children}</AppFrame>
    </Suspense>
  );
}
