"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";

export interface NavLink {
  href: string;
  label: string;
}

export function MobileNav({ links, email }: { links: NavLink[]; email: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sm:hidden">
      <button
        type="button"
        className="flex size-9 items-center justify-center rounded-md border"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </button>

      {open ? (
        <nav aria-label="Mobile" className="absolute inset-x-0 top-14 z-30 border-b bg-card px-4 py-3 shadow-md">
          <ul className="flex flex-col gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)} className="block rounded-md px-2 py-2 text-sm font-medium hover:bg-secondary">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <form action={signOut} className="mt-3">
            <Button type="submit" variant="outline" className="w-full" title={email ?? undefined}>
              Sign out
            </Button>
          </form>
        </nav>
      ) : null}
    </div>
  );
}
