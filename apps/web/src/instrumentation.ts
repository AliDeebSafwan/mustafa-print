/**
 * Runs once when the website's server starts, before it answers any request. In production it refuses to start with
 * missing or unsafe addresses: every one of them has a localhost fallback for development, so a forgotten setting would
 * otherwise go unnoticed and the live site would quietly point search engines and pictures at localhost.
 *
 * Only at runtime: `next build` (also run by CI, with no addresses at all) is left alone.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const problems = productionAddressProblems(process.env);
  if (problems.length) {
    // Exit rather than throw: Next.js catches an error here and keeps the port open, answering every page with a 500,
    // which a port-based health check reads as "up". Exiting makes the host report the failure, with this reason.
    console.error(`The website cannot start with this configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * What is wrong with the addresses, in plain words; empty when all is well.
 * - SITE_URL and PUBLIC_API_URL are seen by browsers, so on a live site they must be https: an http picture on an https
 *   page is blocked as mixed content. Plain http is accepted only on this machine, for deliberate local testing.
 * - API_INTERNAL_URL is server-to-server inside the private network (http://api:4000 behind Caddy): plain http is right.
 */
export function productionAddressProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  for (const key of ["SITE_URL", "PUBLIC_API_URL", "API_INTERNAL_URL"]) {
    if (!env[key]) problems.push(`${key} is not set`);
  }
  for (const key of ["SITE_URL", "PUBLIC_API_URL"]) {
    const value = env[key];
    if (!value) continue;
    let url: URL;
    try { url = new URL(value); } catch { problems.push(`${key} is not a valid address: ${value}`); continue; }
    if (url.protocol !== "https:" && !LOOPBACK.has(url.hostname)) problems.push(`${key} must use https on a live site: ${value}`);
  }
  return problems;
}
