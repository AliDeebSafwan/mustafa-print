import Link from "next/link";
import type { Locale, PublicService } from "@mpe/shared";
import { Picture } from "./picture";

/** `heading` follows the page's outline: h3 under a section heading (home), h2 directly under the page title (services). */
export function ServiceCard({ service, lang, moreLabel, heading = "h3" }: { service: PublicService; lang: Locale; moreLabel: string; heading?: "h2" | "h3" }) {
  const Title = heading;
  return (
    <li className="group border-b border-rule py-5">
      <Link href={`/${lang}/services/${service.slug}`} className="flex gap-4">
        {service.image && <Picture image={service.image} sizes="96px" className="size-24 shrink-0 bg-tint object-cover" />}
        <div className="min-w-0">
          <Title className="text-lg font-bold group-hover:underline group-hover:underline-offset-4">{service.title}</Title>
          {service.summary && <p className="mt-1 leading-7 text-muted">{service.summary}</p>}
          <span className="mt-1 inline-block text-sm font-semibold">{moreLabel} <span className="arrow-go" aria-hidden="true">←</span></span>
        </div>
      </Link>
    </li>
  );
}
