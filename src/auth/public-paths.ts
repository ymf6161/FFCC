/**
 * Paths anyone may open without signing in. Matched by whole path segment, so
 * /login and /login/… are public but /login-history is not.
 */
const PUBLIC_PREFIXES = ["/login"] as const;
const PUBLIC_FILES = new Set(["/icon.svg", "/favicon.ico"]);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_FILES.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
