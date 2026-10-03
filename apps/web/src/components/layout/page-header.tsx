/** The title band every inner page opens with: a field of faint grid light that runs edge to edge, closed by a line of
 *  light, with the title lit in the headline face. */
export function PageHeader({ title, intro }: { title: string; intro?: string }) {
  return (
    <div className="full halftone-field relative border-b border-rule py-10 after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-[linear-gradient(90deg,transparent,var(--cyan),var(--magenta),transparent)] after:content-[''] sm:py-14">
      <h1 className="t-page t-glow w-fit">{title}</h1>
      {intro && <p className="t-lead mt-3 max-w-2xl">{intro}</p>}
    </div>
  );
}
