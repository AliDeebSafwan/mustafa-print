"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicGalleryItem } from "@mpe/shared";

interface Labels { close: string; previous: string; next: string; photo: string }
interface Props { items: PublicGalleryItem[]; labels: Labels; apiBase: string }

const srcsetOf = (base: string, image: PublicGalleryItem["images"][number]) => image.srcset.map((v) => `${base}${v.src} ${v.width}w`).join(", ");
const largest = (base: string, image: PublicGalleryItem["images"][number]) => `${base}${image.srcset.at(-1)?.src ?? ""}`;

/**
 * The showroom grid, and a full-screen viewer for a piece of work's pictures. The viewer is a native <dialog>:
 * it traps focus, closes on Escape, and returns focus where it came from, without any extra library.
 */
export function GalleryGrid({ items, labels, apiBase }: Props) {
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
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item) => {
          const cover = item.images[0];
          if (!cover) return null;
          return (
            <li key={item.id}>
              <button type="button" className="group block w-full text-start" onClick={() => setOpen({ item, index: 0 })}>
                {/* eslint-disable-next-line @next/next/no-img-element -- already resized by the API */}
                <img src={`${apiBase}${cover.srcset[0]?.src ?? ""}`} srcSet={srcsetOf(apiBase, cover)} sizes="(min-width: 640px) 33vw, 50vw"
                  width={cover.width} height={cover.height} alt={cover.alt} loading="lazy" decoding="async" className="aspect-square w-full bg-tint object-cover" />
                <span className="mt-2 block font-semibold group-hover:underline group-hover:underline-offset-4">{item.title}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <dialog ref={dialog} onClose={() => setOpen(null)} aria-label={open?.item.title} className="m-auto max-h-dvh max-w-4xl bg-paper p-0 backdrop:bg-ink/80">
        {open && current && (
          <div className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-bold">{open.item.title}</p>
                {open.item.description && <p className="mt-1 text-sm leading-6 text-muted">{open.item.description}</p>}
              </div>
              <button type="button" className="shrink-0 border border-ink px-3 py-1.5 text-sm font-semibold" onClick={() => setOpen(null)} autoFocus>{labels.close}</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- already resized by the API */}
            <img src={largest(apiBase, current)} alt={current.alt} width={current.width} height={current.height} className="mt-3 max-h-[70dvh] w-full object-contain" />
            {open.item.images.length > 1 && (
              <div className="mt-3 flex items-center justify-between">
                <button type="button" className="border border-ink px-3 py-2 text-sm font-semibold" onClick={() => step(-1)}>{labels.previous}</button>
                <span className="text-sm text-muted" aria-live="polite">{labels.photo.replace("{{n}}", String(open.index + 1)).replace("{{total}}", String(open.item.images.length))}</span>
                <button type="button" className="border border-ink px-3 py-2 text-sm font-semibold" onClick={() => step(1)}>{labels.next}</button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
