const PUBLIC_EXACT = ["/", "/sign-in", "/sign-up", "/auth/callback"];
const PUBLIC_PREFIXES = ["/map/", "/api/webhooks/"];

/** Paths reachable without a session. Everything else requires sign-in. */
export function isPublic(pathname: string): boolean {
  return (
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
