import type { Locale } from "@mpe/shared";

/*
 * The locale tags every price, quantity and date on the site is formatted with, so a quote reads the same way as the
 * order it becomes. Arabic pages keep Western digits ("nu-latn"): they are what the shop's prices, phone numbers and
 * order codes are written in. Numbers and dates need different tags to get both right for Lebanon:
 *   numbers  ar-u-nu-latn     -> 1,234.50 US$            (ar-LB would write 1.234,50)
 *   dates    ar-LB-u-nu-latn  -> 12 تشرين الأول 2026     (generic Arabic would say أكتوبر)
 */
export const numberLocale = (lang: Locale): string => (lang === "ar" ? "ar-u-nu-latn" : "en-GB");
export const dateLocale = (lang: Locale): string => (lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB");

/** Every price on the site reads the same way, in the catalogue, the cart, a quote and an order: "1,234.50 USD".
 *  Show it inside an element with dir="ltr", so the currency code stays after the number in Arabic text. */
export const formatMoney = (amount: number | string, currency: string, lang: Locale): string =>
  `${new Intl.NumberFormat(numberLocale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount))} ${currency}`;
