/** Quote one CSV field, defusing spreadsheet formulas. */
export function csvField(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+@\t\r]/.test(text) || /^-[^0-9£]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV with a fixed header, built from rows keyed by column name. */
export function toCsv<C extends string>(
  columns: readonly C[],
  rows: ReadonlyArray<Partial<Record<C, string | number | boolean | null>>>,
): string {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvField(row[c])).join(','));
  return `${lines.join('\n')}\n`;
}
