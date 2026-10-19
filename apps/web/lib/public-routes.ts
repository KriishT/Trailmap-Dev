const PUBLIC_EXACT = ["/", "/sign-in", "/sign-up", "/auth/callback", "/demo"];
const PUBLIC_PREFIXES = ["/map/", "/api/webhooks/", "/api/demo/", "/demo/"];
/** Visitors to a share link prove a password here before they have any session. */
const PUBLIC_PATTERNS = [/^\/api\/maps\/[^/]+\/unlock$/];

/** Paths reachable without a session. Everything else requires sign-in. */
export function isPublic(pathname: string): boolean {
  return (
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    PUBLIC_PATTERNS.some((re) => re.test(pathname))
  );
}
