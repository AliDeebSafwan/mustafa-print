import { describe, expect, it } from 'vitest';
import { templateProblems } from '../contracts/notifications';

const whatsapp = { channel: 'whatsapp', variables: ['customer_name', 'order_id', 'tracking_url'], provider_template_name: 'order_received_v1' };

describe('what makes a template edit wrong', () => {
  it('lets the wording change freely when the variables stay the same, even for an approved WhatsApp template', () => {
    expect(templateProblems(whatsapp, { body: 'Hi {{customer_name}}! Order {{order_id}}: {{tracking_url}}' })).toEqual([]);
  });

  it('refuses a variable nobody fills in', () => {
    expect(templateProblems({ ...whatsapp, channel: 'sms', provider_template_name: null }, { body: 'Hi {{customer_nmae}}' }))
      .toEqual([{ code: 'unknown_variables', names: ['customer_nmae'] }]);
  });

  it('refuses reordering the variables of an approved WhatsApp template, which would put the name where the number goes', () => {
    expect(templateProblems(whatsapp, { body: 'Order {{order_id}} for {{customer_name}}: {{tracking_url}}' })).toEqual([
      { code: 'whatsapp_variables_changed', expected: ['customer_name', 'order_id', 'tracking_url'], got: ['order_id', 'customer_name', 'tracking_url'] },
    ]);
    expect(templateProblems(whatsapp, { body: 'Hi {{customer_name}}, order {{order_id}}' })[0]).toMatchObject({ code: 'whatsapp_variables_changed' });
  });

  it('allows new variables once the edit also names a newly approved template', () => {
    expect(templateProblems(whatsapp, { body: 'Order {{order_id}} for {{customer_name}}', provider_template_name: 'order_received_v2' })).toEqual([]);
  });

  it('SMS and email change freely, but an email needs a subject', () => {
    expect(templateProblems({ channel: 'sms', variables: ['order_id'], provider_template_name: null }, { body: '{{customer_name}}: {{total}} {{currency}}' })).toEqual([]);
    expect(templateProblems({ channel: 'email', variables: [], provider_template_name: null }, { body: 'Hello', subject: '' })).toEqual([{ code: 'email_needs_subject' }]);
    expect(templateProblems({ channel: 'email', variables: [], provider_template_name: null }, { body: 'Hello', subject: 'Order {{bad}}' }))
      .toEqual([{ code: 'unknown_variables', names: ['bad'] }]);
  });
});
