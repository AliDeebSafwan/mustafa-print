import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { SITE_TAG } from "@/lib/site";

/**
 * Called by the API after the owner changes something the public sees, so the change shows on the very next visit.
 * `expire: 0` rather than the "max" profile: with "max" the next visitor still gets the old page once, and the owner
 * is usually that next visitor, checking what they just published.
 */
export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });

  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "unauthorized" }, { status: 401 });

  revalidateTag(SITE_TAG, { expire: 0 });
  return Response.json({ revalidated: true });
}
