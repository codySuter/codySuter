/** RFC-4180-ish parser: quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      // A quote only opens a quoted field at the field's start. Mid-field
      // it is literal — hardware descriptions are full of inch marks, and
      // one stray 3" must not swallow the rest of the file.
      if (field === '') inQuotes = true;
      else field += c;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}
