/** Minimal RFC 4180 CSV support: quoted fields, embedded commas, quotes and line breaks, CRLF or LF. */

export type CsvParse = { ok: true; rows: string[][] } | { ok: false; error: string };

export function parseCsv(text: string): CsvParse {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.trim() !== '') return { ok: false, error: `Row ${line} has a quote in the middle of a value. Wrap the whole value in quotes.` };
      field = '';
      quoted = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; line++;
    } else {
      field += ch;
    }
  }
  if (quoted) return { ok: false, error: 'The file ends inside a quoted value. Check for a missing closing quote.' };
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return { ok: true, rows };
}

/** Values starting with these could run as formulas when a downloaded file is opened in a spreadsheet. */
const FORMULA = /^[=@\t\r]|^[+-](?![\d\s()]*$)/;

function cell(v: string): string {
  const safe = FORMULA.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV text with a UTF-8 byte order mark and CRLF line endings, so spreadsheet apps open it correctly. */
export function toCsv(rows: string[][]): string {
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** Saves a CSV file to the user's device. */
export function downloadCsv(fileName: string, rows: string[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
