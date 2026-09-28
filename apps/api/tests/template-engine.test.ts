import { describe, expect, it } from 'vitest';
import { TEMPLATE_KEYS, TEMPLATE_VARIABLES } from '@mpe/shared';
import { buildDefaultTemplates } from '../src/modules/messaging/default-templates';
import { MissingVariableError, escapeHtml, extractVariables, findUnknownVariables, renderTemplate } from '../src/modules/messaging/template-engine';

describe('template engine', () => {
  it('renders the example from the brief', () => {
    const out = renderTemplate('مرحباً {{customer_name}}، طلبك رقم {{order_id}} أصبح جاهزاً!', { customer_name: 'علي', order_id: 1042 });
    expect(out).toBe('مرحباً علي، طلبك رقم 1042 أصبح جاهزاً!');
  });
  it('tolerates spaces and case in placeholders', () => {
    expect(renderTemplate('{{ Customer_Name }}', { customer_name: 'A' })).toBe('A');
  });
  it('fails loudly on missing values instead of sending a broken message', () => {
    expect(() => renderTemplate('hi {{customer_name}} {{does_not_exist}}', { customer_name: 'A', does_not_exist: null })).toThrow(MissingVariableError);
  });
  it('is single-pass: values are never re-interpreted as placeholders', () => {
    expect(renderTemplate('{{customer_name}} {{order_id}}', { customer_name: '{{order_id}}', order_id: 7 })).toBe('{{order_id}} 7');
  });
  it('escapes HTML only when asked', () => {
    expect(renderTemplate('{{customer_name}}', { customer_name: '<b>x</b>' }, { escapeHtml: true })).toBe('&lt;b&gt;x&lt;/b&gt;');
    expect(renderTemplate('{{customer_name}}', { customer_name: '<b>x</b>' })).toBe('<b>x</b>');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });
  it('extracts variables in order without duplicates and flags unknown ones', () => {
    expect(extractVariables('{{b}} {{a}} {{b}}')).toEqual(['b', 'a']);
    expect(findUnknownVariables('{{customer_name}} {{password}}', TEMPLATE_VARIABLES)).toEqual(['password']);
  });
  it('ships default templates that only use whitelisted variables', () => {
    const all = buildDefaultTemplates();
    expect(all).toHaveLength(TEMPLATE_KEYS.length * 2 * 3); // every key x 2 locales x 3 channels
    for (const t of all) expect(findUnknownVariables(t.body, TEMPLATE_VARIABLES)).toEqual([]);
    expect(all.filter((t) => t.channel === 'email').every((t) => !!t.subject)).toBe(true);
  });
});
