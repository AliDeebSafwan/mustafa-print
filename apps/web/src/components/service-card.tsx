import Link from "next/link";
import type { Locale, PublicService } from "@mpe/shared";
import { Picture } from "./ui/picture";

/** A swatch chip: the picture over the name plate. `heading` follows the page's outline: h3 under a section heading
 *  (home), h2 directly under the page title (services). */
export function ServiceCard({ service, lang, heading = "h3", priority = false }: { service: PublicService; lang: Locale; heading?: "h2" | "h3"; /** In the first row on screen: fetch now, not lazily. */ priority?: boolean }) {
  const Title = heading;
  return (
    <li className="chip">
      <Link href={`/${lang}/services/${service.slug}`} className="flex h-full flex-col">
        <div className="chip-art aspect-[4/3]">
          {service.image ? <Picture image={service.image} sizes="(min-width: 768px) 33vw, 50vw" className="size-full" priority={priority} /> : null}
        </div>
        <div className="chip-label">
          <Title className="font-display text-lg leading-snug font-extrabold sm:text-xl">{service.title}</Title>
          {service.summary && <p className="mt-1 line-clamp-2 hidden text-[.95rem] leading-7 text-muted sm:block">{service.summary}</p>}
        </div>
      </Link>
    </li>
  );
}
