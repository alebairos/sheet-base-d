import { parseA1 } from "../src/addr.js";
import { ERROR_CODES, encodeCell, type Value } from "../src/value.js";
import {
  computeWorkbook,
  parseWorkbook,
  type InputCell,
  type Workbook,
  type WorkbookJson,
} from "../src/workbook.js";

export type { Workbook };

export type Sel = { col: number; row: number };

export type GridCell = {
  display: string;
  error: boolean;
  align: "left" | "right";
};

export type GridModel = {
  sheet: string;
  sheets: string[];
  cols: number;
  rows: number;
  labels: string[];
  cells: GridCell[][];
  bar: { text: string; error: string | null };
  sel: Sel;
  clipped: boolean;
};

const MIN_COLS = 12;
const MIN_ROWS = 24;
const MAX_COLS = 40;
const MAX_ROWS = 200;
const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

export function emptyWorkbook(): Workbook {
  return { sheets: { Sheet1: {} } };
}

export function workbookFromJson(text: string): Workbook {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("invalid JSON");
  }
  return parseWorkbook(raw);
}

export function workbookToJson(wb: Workbook): string {
  return `${JSON.stringify(encodeInputWorkbook(wb), null, 2)}\n`;
}

export function sheetToCsv(wb: Workbook, sheet: string): string {
  const table = wb.sheets[sheet];
  if (table === undefined) throw new Error("missing sheet");
  const used = extent(table);
  const rows: string[][] = [];
  for (let r = 0; r < used.rows; r++) {
    const line: string[] = [];
    for (let c = 0; c < used.cols; c++) line.push(formatInput(table[a1(c, r)]));
    rows.push(line);
  }
  return encodeCsv(rows);
}

export function csvToWorkbook(text: string, sheetName = "Sheet1"): Workbook {
  if (sheetName === "") throw new Error("missing sheet");
  const rows = parseCsv(text);
  const cells: Record<string, InputCell> = {};
  for (let r = 0; r < rows.length; r++) {
    const line = rows[r] ?? [];
    for (let c = 0; c < line.length; c++) {
      const parsed = parseEdit(line[c] ?? "");
      if (parsed !== undefined) cells[a1(c, r)] = parsed;
    }
  }
  return { sheets: { [sheetName]: cells } };
}

export function writeCell(wb: Workbook, sheet: string, sel: Sel, text: string): Workbook {
  const current = wb.sheets[sheet];
  if (current === undefined) throw new Error("missing sheet");
  const next = { ...current };
  const key = a1(sel.col, sel.row);
  const parsed = parseEdit(text);
  if (parsed === undefined) delete next[key];
  else next[key] = parsed;
  return { sheets: { ...wb.sheets, [sheet]: next } };
}

export function gridModel(wb: Workbook, sheet: string, sel: Sel): GridModel {
  const sheets = Object.keys(wb.sheets);
  const active = Object.hasOwn(wb.sheets, sheet) ? sheet : (sheets[0] ?? "Sheet1");
  const table = wb.sheets[active] ?? {};
  const used = extent(table);
  const cols = clamp(Math.max(MIN_COLS, used.cols, sel.col + 1), MIN_COLS, MAX_COLS);
  const rows = clamp(Math.max(MIN_ROWS, used.rows, sel.row + 1), MIN_ROWS, MAX_ROWS);
  const picked: Sel = {
    col: clamp(sel.col, 0, cols - 1),
    row: clamp(sel.row, 0, rows - 1),
  };
  const computed = computeWorkbook(wb).sheets[active] ?? {};
  const labels: string[] = [];
  const cells: GridCell[][] = [];
  for (let c = 0; c < cols; c++) labels.push(columnLabel(c));
  for (let r = 0; r < rows; r++) {
    const line: GridCell[] = [];
    for (let c = 0; c < cols; c++) line.push(cellView(computed[a1(c, r)]));
    cells.push(line);
  }
  const key = a1(picked.col, picked.row);
  const view = cellView(computed[key]);
  return {
    sheet: active,
    sheets: sheets.length === 0 ? [active] : sheets,
    cols,
    rows,
    labels,
    cells,
    bar: { text: formatInput(table[key]), error: view.error ? view.display : null },
    sel: picked,
    clipped: used.cols > cols || used.rows > rows,
  };
}

function encodeInputWorkbook(wb: Workbook): WorkbookJson {
  const sheets: WorkbookJson["sheets"] = {};
  for (const [name, cells] of Object.entries(wb.sheets)) {
    const out: WorkbookJson["sheets"][string] = {};
    for (const [key, cell] of Object.entries(cells)) {
      if (cell.kind === "formula") {
        out[key] = cell.src;
        continue;
      }
      const encoded = encodeCell(cell);
      if (encoded !== null) out[key] = encoded;
    }
    sheets[name] = out;
  }
  return { sheets };
}

function formatInput(cell: InputCell | undefined): string {
  if (cell === undefined) return "";
  switch (cell.kind) {
    case "formula":
      return cell.src;
    case "number":
      return JSON.stringify(cell.n);
    case "text":
      return cell.t;
    case "bool":
      return cell.b ? "TRUE" : "FALSE";
    case "blank":
      return "";
    case "error":
      return cell.code;
    default: {
      const exhaustive: never = cell;
      return exhaustive;
    }
  }
}

function parseEdit(text: string): InputCell | undefined {
  if (text === "") return undefined;
  if (text.startsWith("=")) return { kind: "formula", src: text };
  for (const code of ERROR_CODES) {
    if (text === code) return { kind: "error", code };
  }
  if (/^true$/i.test(text)) return { kind: "bool", b: true };
  if (/^false$/i.test(text)) return { kind: "bool", b: false };
  if (NUMBER.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n)) return { kind: "number", n };
  }
  return { kind: "text", t: text };
}

function cellView(value: Value | undefined): GridCell {
  if (value === undefined || value.kind === "blank") return { display: "", error: false, align: "left" };
  if (value.kind === "error") return { display: value.code, error: true, align: "left" };
  if (value.kind === "number") return { display: JSON.stringify(value.n), error: false, align: "right" };
  if (value.kind === "bool") return { display: value.b ? "TRUE" : "FALSE", error: false, align: "right" };
  return { display: value.t, error: false, align: "left" };
}

function extent(table: Record<string, InputCell>): { cols: number; rows: number } {
  let cols = 0;
  let rows = 0;
  for (const key of Object.keys(table)) {
    const addr = parseA1(key);
    if (addr === null) continue;
    cols = Math.max(cols, addr.col + 1);
    rows = Math.max(rows, addr.row + 1);
  }
  return { cols, rows };
}

function columnLabel(col: number): string {
  if (!Number.isSafeInteger(col) || col < 0) throw new Error("bad column");
  let n = col + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function a1(col: number, row: number): string {
  if (!Number.isSafeInteger(row) || row < 0) throw new Error("bad row");
  return `${columnLabel(col)}${row + 1}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function encodeCsv(rows: string[][]): string {
  if (rows.length === 0) return "";
  return `${rows.map((row) => row.map(encodeField).join(",")).join("\n")}\n`;
}

function encodeField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  if (src === "") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; ) {
    const c = src[i] ?? "";
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (quoted) throw new Error("invalid CSV");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
