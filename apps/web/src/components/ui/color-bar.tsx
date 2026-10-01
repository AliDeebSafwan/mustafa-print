/** The colour bar printers add to a press sheet, as light: cyan, violet, magenta, yellow in one glowing line.
 *  Decorative, so hidden from assistive tech. */
export function ColorBar() {
  return <div aria-hidden className="h-[3px] w-full bg-[linear-gradient(90deg,var(--cyan),#7f00ff,var(--magenta),var(--yellow))] shadow-[0_0_14px_rgb(0_242_254/.55)]" />;
}
