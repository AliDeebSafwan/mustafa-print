import type { PublicImage } from "@mpe/shared";
import { imageAttrs } from "@/lib/site";

/** A published picture at the smallest size that looks sharp in its box. The width and height stop the page jumping. */
export function Picture({ image, sizes, className, priority = false }: { image: PublicImage; sizes: string; className?: string; priority?: boolean }) {
  const { src, srcSet, width, height, alt } = imageAttrs(image);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- pictures are already resized by the API; next/image would resize them again
  return <img src={src} srcSet={srcSet} width={width} height={height} alt={alt} sizes={sizes} className={className} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" />;
}
