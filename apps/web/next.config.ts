import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",                                   // small Docker image for the VPS
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."), // monorepo: trace @mpe/shared too
  transpilePackages: ["@mpe/shared"],                     // shared package ships TypeScript sources
  poweredByHeader: false,
  // The customer's account lives on the website's own address, so its session cookie is first-party. In production
  // Caddy sends /api/v1/public/* straight to the API; this rewrite does the same wherever Caddy is not in front.
  async rewrites() {
    return [{ source: "/api/v1/public/:path*", destination: `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/api/v1/public/:path*` }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        // Production only: development mode needs eval for hot reload. Next.js injects inline bootstrap scripts, so
        // 'unsafe-inline' stays until nonces are wired in; what this still blocks is the common case — a script
        // loaded from another site, the page framed elsewhere, a form posting off-site, plugins, a rewritten <base>.
        ...(process.env.NODE_ENV === "production" ? [{
          key: "Content-Security-Policy",
          value: ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
            "font-src 'self' data:", "connect-src 'self'", "frame-ancestors 'self'", "form-action 'self'", "base-uri 'self'", "object-src 'none'"].join("; "),
        }] : []),
      ],
    }];
  },
};

export default nextConfig;
