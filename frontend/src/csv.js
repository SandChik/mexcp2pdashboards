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
