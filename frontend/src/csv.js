/**
 * CSV export. Uses a BOM + semicolon separator so Excel in Indonesian locale
 * opens it with columns already split, instead of dumping everything into
 * column A — the usual reason "export to CSV" ends up useless in practice.
 */
function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename, headers, rows) {
  const body = [headers.map(cell).join(';'), ...rows.map(r => r.map(cell).join(';'))].join('\r\n');
  const blob = new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Date stamp for filenames: 2026-07-27 */
export const stamp = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);

/**
 * Minimal CSV reader — no dependency, on purpose. The separator is detected per
 * file (Excel writes ';' on Indonesian locale and ',' on English, and users
 * paste tab-separated text straight out of a sheet), so the same template works
 * whichever Excel produced it.
 * Returns { headers: string[], rows: string[][] } with empty lines dropped.
 */
export function parseCsv(text) {
  let s = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!s.trim()) return { headers: [], rows: [] };

  // Detect separator from the header line only, ignoring anything inside quotes.
  const firstLine = s.split('\n')[0].replace(/"[^"]*"/g, '');
  const sep = [';', '\t', ','].reduce((best, c) => {
    const n = firstLine.split(c).length - 1;
    return n > best.n ? { c, n } : best;
  }, { c: ';', n: 0 }).c;

  const out = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell);
  out.push(row);

  const cleaned = out
    .map(r => r.map(v => v.trim()))
    .filter(r => r.some(v => v !== ''));
  if (cleaned.length === 0) return { headers: [], rows: [] };
  return { headers: cleaned[0], rows: cleaned.slice(1) };
}

/**
 * Number from a human-typed cell. Handles "1.500.000", "1,500,000", "1500000",
 * "12,5" and "Rp 1.500.000". Returns null when the cell holds no number at all,
 * so the caller can fall back to a default instead of storing NaN.
 */
export function parseNum(v) {
  let s = String(v ?? '').replace(/[^\d.,-]/g, '').trim();
  if (!s) return null;
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // Whichever comes last is the decimal mark.
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * Timestamp from a date cell. Accepts 2026-08-11, 2026-08-11 14:30,
 * 11/08/2026 (day first — Indonesian convention) and 11-08-2026.
 * Returns null when unreadable, so the row can be flagged instead of silently
 * landing on 1970.
 */
export function parseDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}
