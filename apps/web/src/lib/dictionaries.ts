import "server-only";
import type { Locale } from "@mpe/shared";
import type ar from "@/dictionaries/ar.json";

/** Arabic is the source of truth; English must have exactly the same shape (checked by the compiler below). */
export type Dictionary = typeof ar;

const loaders: Record<Locale, () => Promise<Dictionary>> = {
  ar: () => import("@/dictionaries/ar.json").then((m) => m.default),
  en: () => import("@/dictionaries/en.json").then((m) => m.default),
};

export const getDictionary = (locale: Locale): Promise<Dictionary> => loaders[locale]();
