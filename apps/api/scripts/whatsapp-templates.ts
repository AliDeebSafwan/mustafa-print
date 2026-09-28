/** Prints the WhatsApp templates to create/approve in Meta Business Manager (variables become {{1}}, {{2}}, ...). */
import { buildDefaultTemplates } from '../src/modules/messaging/default-templates';

for (const t of buildDefaultTemplates().filter((x) => x.channel === 'whatsapp')) {
  let body = t.body;
  t.variables.forEach((v, i) => { body = body.replaceAll(new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`, 'gi'), `{{${i + 1}}}`); });
  console.log(`name: ${t.providerTemplateName}   language: ${t.providerTemplateLanguage}   category: UTILITY`);
  console.log(`body: ${body}`);
  console.log(`params (in order): ${t.variables.join(', ') || '(none)'}\n`);
}
