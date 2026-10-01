import { NavLink } from 'react-router'
import { cn } from '../lib/cn'

export interface SectionTab { path: string; label: string }

/**
 * The tab bar of a page mounted on a splat route (`site/*`, `team/*`, …). Each tab links to an absolute address
 * built from `base`: a relative `to` inside a splat route resolves against the whole current URL, so from
 * `/site/gallery` a link to `media` would lead to `/site/gallery/media` and the first tab (`''`) would never leave.
 */
export function SectionTabs({ base, tabs, label, className }: { base: string; tabs: readonly SectionTab[]; label: string; className?: string }) {
  return (
    <nav className="mt-4 grid border border-ink" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }} aria-label={label}>
      {tabs.map((tab) => (
        <NavLink key={tab.path} to={tab.path ? `${base}/${tab.path}` : base} end={!tab.path}
          className={({ isActive }) => cn('py-2.5 text-center font-semibold', className ?? 'text-sm', isActive ? 'bg-ink text-white' : '')}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
