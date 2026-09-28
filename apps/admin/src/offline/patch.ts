import type { Row } from './db'

/**
 * Turns "what the form shows now" into the field-level patch the server expects: only the fields that actually
 * changed, each with the value this device started from (`base`). Fields nobody touched are never sent, which is
 * what lets two people edit different fields of the same row at the same time without either losing their work.
 */
export interface Patch { changes: Record<string, unknown>; base: Record<string, unknown> }

/**
 * A form's empty box, a missing column and an explicit null all mean the same thing: no value.
 * Without this, a box that was empty and stayed empty would look like a change and cause pointless conflicts.
 */
export function blankToNull(value: unknown): unknown {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const same = (a: unknown, b: unknown): boolean => {
  const [x, y] = [blankToNull(a), blankToNull(b)]
  if (x === null || y === null) return x === y
  return String(x) === String(y)
}

/** Null when nothing changed, so the caller sends nothing at all. */
export function buildPatch(original: Row, next: Record<string, unknown>, fields: readonly string[]): Patch | null {
  const patch: Patch = { changes: {}, base: {} }
  for (const field of fields) {
    if (!(field in next) || same(original[field], next[field])) continue
    patch.changes[field] = blankToNull(next[field])
    patch.base[field] = original[field] ?? null
  }
  return Object.keys(patch.changes).length > 0 ? patch : null
}
