// Pure routing decisions for src/proxy.ts. The proxy is an OPTIMISTIC check
// only (cookie/claims based). Real authorization happens in the data access
// layer (src/lib/auth/dal.ts) and in Postgres RLS.

export const PROTECTED_PREFIXES = ["/dashboard", "/founder", "/account", "/onboarding", "/company", "/tables", "/employees"] as const;
export const AUTH_PAGES = ["/login", "/register"] as const;

export type GuardDecision =
  | { action: "next" }
  | { action: "redirect"; to: string };

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

export function resolveGuard(input: {
  pathname: string;
  isAuthenticated: boolean;
  supabaseConfigured: boolean;
}): GuardDecision {
  const { pathname, isAuthenticated, supabaseConfigured } = input;

  if (isProtectedPath(pathname)) {
    if (!supabaseConfigured) return { action: "redirect", to: "/setup" };
    if (!isAuthenticated) {
      return { action: "redirect", to: `/login?next=${encodeURIComponent(pathname)}` };
    }
  }

  if (isAuthenticated && AUTH_PAGES.some((p) => matchesPrefix(pathname, p))) {
    return { action: "redirect", to: "/dashboard" };
  }

  return { action: "next" };
}
