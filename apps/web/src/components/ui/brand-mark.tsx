/** The four inks as a small lit square (key black becomes violet light on the dark page): the shop's mark until it has a logo of its own. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-2 overflow-hidden rounded-[7px] shadow-[0_0_16px_rgb(0_242_254/.45)]" style={{ width: size, height: size }}>
      <span className="bg-cyan" /><span className="bg-magenta" /><span className="bg-yellow" /><span className="bg-[#7f00ff]" />
    </span>
  );
}
