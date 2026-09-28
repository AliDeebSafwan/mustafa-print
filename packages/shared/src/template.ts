/**
 * Tiny, safe template engine for {{variable}} placeholders.
 *  - single pass: substituted values are NEVER re-scanned, so a customer named "{{tracking_url}}" cannot inject
 *  - unknown / missing variables are errors, never silently blank
 */
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;

export class MissingVariableError extends Error {
  readonly names: string[];
  constructor(names: string[]) {
    super(`Missing template variables: ${names.join(', ')}`);
    this.name = 'MissingVariableError';
    this.names = names;
  }
}

export type TemplateValues = Record<string, string | number | null | undefined>;

export function extractVariables(template: string): string[] {
  const seen = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER)) seen.add(m[1]!.toLowerCase());
  return [...seen];
}

/** Use when an admin saves a template: returns the variables that are not on the whitelist. */
export function findUnknownVariables(template: string, allowed: readonly string[]): string[] {
  return extractVariables(template).filter((v) => !allowed.includes(v));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderTemplate(template: string, values: TemplateValues, opts: { escapeHtml?: boolean } = {}): string {
  const missing: string[] = [];
  const out = template.replace(PLACEHOLDER, (_match, rawName: string) => {
    const name = rawName.toLowerCase();
    const value = values[name];
    if (value === null || value === undefined) {
      missing.push(name);
      return '';
    }
    const text = String(value);
    return opts.escapeHtml ? escapeHtml(text) : text;
  });
  if (missing.length > 0) throw new MissingVariableError([...new Set(missing)]);
  return out;
}

/** Believable values for previewing a message while editing it. */
export const SAMPLE_TEMPLATE_VALUES = {
  customer_name: 'Rana', order_id: '1042', tracking_url: 'https://example.com/ar/track/K7M2Q9X4TB3D', total: '40.50',
  currency: 'USD', branch_name: 'Mustafa Print',
} as const;
