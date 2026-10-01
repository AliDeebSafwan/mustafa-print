"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicGalleryItem } from "@mpe/shared";

interface Labels { close: string; previous: string; next: string; photo: string }
interface Props { items: PublicGalleryItem[]; labels: Labels; apiBase: string; /** Show the first piece large, as the showroom's lead. */ lead?: boolean; /** The grid opens the page: fetch its first row at once instead of lazily. */ eager?: boolean }

const srcsetOf = (base: string, image: PublicGalleryItem["images"][number]) => image.srcset.map((v) => `${base}${v.src} ${v.width}w`).join(", ");
const largest = (base: string, image: PublicGalleryItem["images"][number]) => `${base}${image.srcset.at(-1)?.src ?? ""}`;

/**
 * The showroom grid, and a full-screen viewer for a piece of work's pictures. The viewer is a native <dialog>:
 * it traps focus, closes on Escape, and returns focus where it came from, without any extra library.
 */
export function GalleryGrid({ items, labels, apiBase, lead = false, eager = false }: Props) {
  const [open, setOpen] = useState<{ item: PublicGalleryItem; index: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const step = (by: number) => setOpen((o) => (o ? { ...o, index: (o.index + by + o.item.images.length) % o.item.images.length } : o));
  const current = open ? open.item.images[open.index] : undefined;

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
        {items.map((item, index) => {
          const cover = item.images[0];
          if (!cover) return null;
          const big = lead && index === 0;
          return (
            <li key={item.id} className={big ? "col-span-2 md:row-span-2" : undefined}>
              <button type="button" className="chip group h-full w-full text-start" onClick={() => setOpen({ item, index: 0 })}>
                <span className={`chip-art block w-full ${big ? "aspect-[4/3] md:aspect-auto md:flex-1" : "aspect-square"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- already resized by the API */}
                  <img src={`${apiBase}${cover.srcset[0]?.src ?? ""}`} srcSet={srcsetOf(apiBase, cover)} sizes={big ? "(min-width: 768px) 50vw, 100vw" : "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"}
                    width={cover.width} height={cover.height} alt={cover.alt} loading={eager && index < 2 ? "eager" : "lazy"} fetchPriority={eager && index === 0 ? "high" : "auto"} decoding="async" className="absolute inset-0 size-full object-cover" />
                </span>
                <span className="chip-label block">
                  <span className={`font-display block leading-snug font-extrabold ${big ? "text-xl sm:text-2xl" : "text-base sm:text-lg"}`}>{item.title}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <dialog ref={dialog} onClose={() => setOpen(null)} aria-label={open?.item.title} className="m-auto max-h-dvh max-w-4xl overflow-hidden rounded-[18px] bg-stock p-0 shadow-[0_0_0_1px_var(--edge)] backdrop:bg-deep/85 backdrop:backdrop-blur-sm">
        {open && current && (
          <div className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-bold">{open.item.title}</p>
                {open.item.description && <p className="mt-1 text-sm leading-6 text-muted">{open.item.description}</p>}
              </div>
              <button type="button" className="btn btn-outline btn-sm shrink-0" onClick={() => setOpen(null)} autoFocus>{labels.close}</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- already resized by the API */}
            <img src={largest(apiBase, current)} alt={current.alt} width={current.width} height={current.height} className="mt-3 max-h-[70dvh] w-full object-contain" />
            {open.item.images.length > 1 && (
              <div className="mt-3 flex items-center justify-between">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => step(-1)}>{labels.previous}</button>
                <span className="text-sm text-muted" aria-live="polite">{labels.photo.replace("{{n}}", String(open.index + 1)).replace("{{total}}", String(open.item.images.length))}</span>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => step(1)}>{labels.next}</button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
