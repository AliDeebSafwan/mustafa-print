/** The colour bar printers add to a press sheet: cyan, magenta, yellow, key. Decorative, so hidden from assistive tech. */
export function ColorBar() {
  return (
    <div aria-hidden className="flex h-1.5 w-full">
      <span className="flex-1 bg-cyan" />
      <span className="flex-1 bg-magenta" />
      <span className="flex-1 bg-yellow" />
      <span className="flex-1 bg-ink" />
    </div>
  );
}
