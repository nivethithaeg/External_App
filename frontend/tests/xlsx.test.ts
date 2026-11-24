import { describe, expect, it } from 'vitest';
import { buildXlsx, parseCsv } from '../src/lib/xlsx';

describe('xlsx export', () => {
  it('writes a zip with the workbook parts and the cell values', () => {
    const b = buildXlsx(['Name', 'Total'], [['Ravi <K>', 1200], ['Meera', '']]);
    expect(Array.from(b.slice(0, 4))).toEqual([0x50, 0x4b, 3, 4]); // a zip
    const text = new TextDecoder().decode(b);
    for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) expect(text).toContain(part);
    expect(text).toContain('Ravi &lt;K&gt;'); expect(text).toContain('<c r="B2"><v>1200</v></c>');
  });
  it('reads CSV with quotes and line breaks inside cells', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n1,2.5\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], [1, 2.5]]);
  });
});
