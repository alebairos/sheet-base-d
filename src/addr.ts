export type CellAddr = { col: number; row: number };

export function columnIndex(letters: string): number | null {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    const digit = ch.charCodeAt(0) - 64;
    if (digit < 1 || digit > 26) return null;
    n = n * 26 + digit;
    if (!Number.isSafeInteger(n)) return null;
  }
  if (n < 1) return null;
  return n - 1;
}

export function parseA1(text: string): CellAddr | null {
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(text);
  if (match === null) return null;
  const letters = match[1];
  const digits = match[2];
  if (letters === undefined || digits === undefined) return null;
  const col = columnIndex(letters);
  const row = Number(digits);
  if (col === null || !Number.isSafeInteger(row) || row < 1) return null;
  return { col, row: row - 1 };
}

export function parseCellSelector(ref: string): { sheet: string; addr: CellAddr } {
  const bang = ref.lastIndexOf("!");
  if (bang <= 0) throw new Error("cell ref must look like Sheet1!A1");
  const addr = parseA1(ref.slice(bang + 1));
  if (addr === null) throw new Error("cell ref must look like Sheet1!A1");
  return { sheet: ref.slice(0, bang), addr };
}

export type SheetCell = { sheet: string | null; col: number; row: number };

export function collectCells(
  start: SheetCell,
  end: SheetCell,
  currentSheet: string,
): { sheet: string; col: number; row: number }[] | null {
  const sheet = rangeSheet(start, end, currentSheet);
  if (sheet === null) return null;
  const c1 = Math.min(start.col, end.col);
  const c2 = Math.max(start.col, end.col);
  const r1 = Math.min(start.row, end.row);
  const r2 = Math.max(start.row, end.row);
  const cells: { sheet: string; col: number; row: number }[] = [];
  for (let row = r1; row <= r2; row++) {
    for (let col = c1; col <= c2; col++) cells.push({ sheet, col, row });
  }
  return cells;
}

function rangeSheet(start: SheetCell, end: SheetCell, currentSheet: string): string | null {
  if (start.sheet !== null && end.sheet !== null && start.sheet !== end.sheet) return null;
  return start.sheet ?? end.sheet ?? currentSheet;
}
