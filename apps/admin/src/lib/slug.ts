/** "Digital Printing & Design" -> "digital-printing-design". Arabic text yields nothing: the owner types the address. */
export const slugify = (text: string): string =>
  text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
