// DEVELOPMENT / TEST ONLY — see store.ts.
import type { Backend, DataPort } from "@/lib/backend/port";
import { createMockAuthAdminPort, createMockAuthPort, type MockSession } from "@/lib/backend/mock/auth-port";
import { createMockDataPort } from "@/lib/backend/mock/data-port";
import { getMockStore, type MockStore } from "@/lib/backend/mock/store";

export function createMockBackend(session: MockSession, store: MockStore = getMockStore()): Backend {
  return {
    kind: "mock",
    auth: createMockAuthPort(store, session),
    // Rebuilt per call so a sign-in earlier in the same request is seen immediately.
    data: new Proxy({} as DataPort, {
      get: (_t, prop) => (createMockDataPort(store, session.get()) as unknown as Record<string | symbol, unknown>)[prop],
    }),
    authAdmin: createMockAuthAdminPort(store),
  };
}
