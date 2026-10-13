// DEVELOPMENT / TEST ONLY — see store.ts. No real credentials, no email: every
// account uses the dummy MOCK_PASSWORD (unless changed in-session) and
// "email links" are the literal code `mock:<userId>`.
//
// Conventions that let browser tests exercise every auth state:
//   * sign up with an address containing "+confirm" -> account stays unconfirmed
//     (no session; the verification screen is shown). Open
//     /auth/callback?code=mock:<userId> to confirm it.
//   * password reset / invite links are /auth/callback?code=mock:<userId>&next=...

import {
  type AuthAdminPort,
  type AuthPort,
  type AuthResult,
  type AuthUser,
} from "@/lib/backend/port";
import { MOCK_PASSWORD, newId, type MockStore, type MUser } from "@/lib/backend/mock/store";

export interface MockSession {
  get(): string | null;
  set(userId: string | null): void;
}

const g = globalThis as unknown as { __tdmMockPasswords?: Map<string, string> };
function passwords(): Map<string, string> {
  if (!g.__tdmMockPasswords) g.__tdmMockPasswords = new Map();
  return g.__tdmMockPasswords;
}
export function resetMockPasswords(): void {
  g.__tdmMockPasswords = new Map();
}
const passwordOf = (id: string) => passwords().get(id) ?? MOCK_PASSWORD;

const toAuthUser = (u: MUser): AuthUser => ({
  id: u.id,
  email: u.email,
  emailConfirmed: u.emailConfirmed,
  fullName: u.fullName,
  pendingCompanyName: u.pendingCompanyName,
});

export function mockCodeFor(userId: string): string {
  return `mock:${userId}`;
}

export function createMockAuthPort(store: MockStore, session: MockSession): AuthPort {
  const byEmail = (email: string) => [...store.users.values()].find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  const current = () => {
    const id = session.get();
    return id ? store.users.get(id) ?? null : null;
  };

  return {
    async getUser() {
      const u = current();
      return u ? toAuthUser(u) : null;
    },
    async signInWithPassword(email, password): Promise<AuthResult> {
      const u = byEmail(email);
      if (!u || passwordOf(u.id) !== password) return { ok: false, code: "invalid_credentials" };
      if (!u.emailConfirmed) return { ok: false, code: "email_not_confirmed" };
      session.set(u.id);
      return { ok: true };
    },
    async signUp({ email, password, fullName, companyName }) {
      if (password.length < 8) return { ok: false, code: "weak_password" };
      // Like Supabase with email confirmation on: an existing address looks identical
      // to a new one (no account enumeration) and starts no session.
      if (byEmail(email)) return { ok: true, sessionStarted: false };
      const confirmed = !/\+confirm@/i.test(email);
      const id = newId(store);
      store.users.set(id, {
        id,
        email: email.trim().toLowerCase(),
        fullName,
        emailConfirmed: confirmed,
        isFounder: false,
        pendingCompanyName: companyName,
        createdAt: new Date(),
      });
      passwords().set(id, password);
      if (confirmed) session.set(id);
      return { ok: true, sessionStarted: confirmed };
    },
    async signOut() {
      session.set(null);
    },
    async verifyPassword(email, password): Promise<AuthResult> {
      const u = byEmail(email);
      return u && passwordOf(u.id) === password ? { ok: true } : { ok: false, code: "invalid_credentials" };
    },
    async updatePassword(newPassword): Promise<AuthResult> {
      const u = current();
      if (!u) return { ok: false, code: "session_required" };
      if (newPassword.length < 8) return { ok: false, code: "weak_password" };
      if (newPassword === passwordOf(u.id)) return { ok: false, code: "same_password" };
      passwords().set(u.id, newPassword);
      return { ok: true };
    },
    async requestPasswordReset(): Promise<AuthResult> {
      // Always succeeds, whether or not the address exists (no enumeration).
      return { ok: true };
    },
    async exchangeCode(code) {
      const m = /^mock:(.+)$/.exec(code);
      const u = m ? store.users.get(m[1]) : undefined;
      if (!u) return false;
      u.emailConfirmed = true;
      session.set(u.id);
      return true;
    },
    async resendConfirmation(): Promise<AuthResult> {
      return { ok: true };
    },
  };
}

export function createMockAuthAdminPort(store: MockStore): AuthAdminPort {
  return {
    async inviteUser({ email, fullName }) {
      if ([...store.users.values()].some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
        return { ok: false, code: "unknown" };
      }
      const id = newId(store);
      store.users.set(id, { id, email: email.trim().toLowerCase(), fullName, emailConfirmed: true, isFounder: false, pendingCompanyName: null, createdAt: new Date() });
      return { ok: true, userId: id };
    },
    async deleteUser(userId) {
      store.users.delete(userId);
      passwords().delete(userId);
    },
  };
}
