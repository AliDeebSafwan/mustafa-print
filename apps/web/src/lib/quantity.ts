/** Keeps a quantity field to a plain positive number as the customer types (integer or up to 3 decimals). */
export function cleanQuantity(raw: string): string {
  let value = raw.replace(/[^\d.]/g, "");
  const firstDot = value.indexOf(".");
  if (firstDot !== -1) value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, "");
  const [whole, frac] = value.split(".");
  return frac !== undefined ? `${whole}.${frac.slice(0, 3)}` : value;
}
