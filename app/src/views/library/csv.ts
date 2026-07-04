/**
 * Small RFC-4180-ish CSV/TSV parser for the workspace file viewer. Handles
 * quoted fields (with escaped `""` and embedded delimiters/newlines) without
 * pulling in a dependency — files here are user workspace docs, not untrusted
 * huge datasets, but we still cap rendered rows in the viewer for safety.
 */

export function parseDelimited(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Swallow \r; \r\n and bare \r both end a row via the \n branch or here.
      if (text[i + 1] === "\n") {
        i += 1;
        continue;
      }
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Trailing field/row (no final newline).
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }
  // Drop a single fully-empty trailing row (common with trailing newline).
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  return rows;
}
