/** The title band every inner page opens with: a stock-coloured field that runs edge to edge, the title in the headline face. */
export function PageHeader({ title, intro }: { title: string; intro?: string }) {
  return (
    <div className="full halftone-field bg-stock py-10 sm:py-14">
      <h1 className="t-page">{title}</h1>
      {intro && <p className="t-lead mt-3 max-w-2xl">{intro}</p>}
    </div>
  );
}
