/** The four process inks as a small square: the shop's mark until it has a logo of its own. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-2 overflow-hidden rounded-[7px]" style={{ width: size, height: size }}>
      <span className="bg-cyan" /><span className="bg-magenta" /><span className="bg-yellow" /><span className="bg-ink" />
    </span>
  );
}
