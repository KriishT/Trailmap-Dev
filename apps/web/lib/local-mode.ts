/**
 * Local mode runs the real application against an embedded Postgres and a mocked GitHub, so the
 * whole product can be tried, developed against and tested end to end with no accounts and no
 * Docker. It is for development and tests only and refuses to run in production.
 */
/** Acknowledgement required to run local mode from a production build. Never set this where real data lives. */
export const SANDBOX_ACK = "i-understand-this-uses-no-real-data";

export function isLocalMode(): boolean {
  if (process.env.TRAILMAP_LOCAL !== "1") return false;
  if (process.env.NODE_ENV === "production" && process.env.TRAILMAP_LOCAL_SANDBOX !== SANDBOX_ACK) {
    throw new Error(
      "TRAILMAP_LOCAL=1 is not allowed in production. To run a throwaway sandbox from a production build " +
        `(no real database, no real credentials, data lost on restart) also set TRAILMAP_LOCAL_SANDBOX=${SANDBOX_ACK}`
    );
  }
  return true;
}

export const LOCAL_COOKIE = "tm_local_user";

export interface LocalUser {
  id: string;
  email: string;
  name: string;
}

/** Fixed accounts available in local mode. `kay` owns the Acme org, `lee` is a plain member, `mia` belongs to another org. */
export const LOCAL_USERS: Record<string, LocalUser> = {
  kay: { id: "00000000-0000-4000-8000-00000000a001", email: "kay@acme.test", name: "Kay Admin" },
  lee: { id: "00000000-0000-4000-8000-00000000a002", email: "lee@acme.test", name: "Lee Reviewer" },
  mia: { id: "00000000-0000-4000-8000-00000000b001", email: "mia@beta.test", name: "Mia Outsider" },
};

export const LOCAL_ORGS = {
  acme: "00000000-0000-4000-8000-0000000a0001",
  beta: "00000000-0000-4000-8000-0000000b0001",
};
export const LOCAL_REPOS = {
  shop: "00000000-0000-4000-8000-000000a00001",
  betaPrivate: "00000000-0000-4000-8000-000000b00001",
};

/** Map a cookie value to a user id. Only known accounts or accounts created through local sign-up are accepted. */
export function localUserFromCookie(value: string | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
