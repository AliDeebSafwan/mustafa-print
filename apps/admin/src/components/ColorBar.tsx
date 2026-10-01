export function ColorBar() {
  return (
    <div aria-hidden className="colorbar flex h-1.5 w-full shrink-0">
      <span className="flex-1 bg-cyan" /><span className="flex-1 bg-magenta" /><span className="flex-1 bg-yellow" /><span className="flex-1 bg-ink" />
    </div>
  )
}
