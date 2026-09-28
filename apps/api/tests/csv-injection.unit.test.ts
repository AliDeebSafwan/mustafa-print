import { expect, it } from 'vitest';
import { toCsv } from '../src/modules/reports/reports.service';
it('neutralises formulas but keeps real numbers numeric', () => {
  const out = toCsv(['name', 'amount'], [
    { name: '=HYPERLINK("http://evil/","x")', amount: '-15.00' }, { name: '+1-555', amount: '20' },
    { name: '@SUM(A1)', amount: '0' }, { name: '-cmd', amount: '3.5' }, { name: 'Karim', amount: '-0' },
  ]);
  expect(out.split('\r\n').slice(1, 6)).toEqual([
    `"'=HYPERLINK(""http://evil/"",""x"")",-15.00`, `'+1-555,20`, `'@SUM(A1),0`, `'-cmd,3.5`, `Karim,-0`,
  ]);
});
