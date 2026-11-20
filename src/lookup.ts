import { asNumber } from "./eval.js";
import type { Fn, FnHost } from "./fn.js";
import type { Expr } from "./parse.js";
import type { ErrorCode, Value } from "./value.js";
import { criteriaMatch, criteriaText, isCriteriaRegex } from "./wild.js";

type Mode = "exact" | "asc" | "desc";
type Grid = { sheet: string; c0: number; r0: number; c1: number; r1: number };
type Err = { kind: "error"; code: ErrorCode };
type Rank = -1 | 0 | 1 | "skip" | "stop";

const EPS = 1 / (16777216 * 16777216);

export const lookupFns = {
  VLOOKUP: vlookup,
  INDEX: index,
  MATCH: match,
} satisfies { readonly [name: string]: Fn };

function vlookup(args: readonly Expr[], host: FnHost): Value {
  if (args.length < 3 || args.length > 4) return err("#VALUE!");
  const keyExpr = args[0];
  const tableExpr = args[1];
  const colExpr = args[2];
  if (keyExpr === undefined || tableExpr === undefined || colExpr === undefined) return err("#VALUE!");
  const key = host.scalar(keyExpr);
  if (key.kind === "error") return key;
  const table = gridOf(tableExpr, host, "#VALUE!");
  if ("code" in table) return table;
  const col = whole(host.scalar(colExpr));
  if (typeof col !== "number") return col;
  const width = table.c1 - table.c0 + 1;
  if (col < 1 || col > width) return err("#NUM!");
  const approx = args.length === 3 ? true : flag(args[3], host);
  if (typeof approx !== "boolean") return approx;
  const hit = findIndex(column(table, table.c0, host), key, approx ? "asc" : "exact");
  if (hit === null) return err("#N/A");
  if (typeof hit !== "number") return hit;
  const found = host.cell(table.sheet, table.c0 + col - 1, table.r0 + hit);
  if (found.kind === "bool") return host.number(found.b ? 1 : 0);
  return found;
}

function index(args: readonly Expr[], host: FnHost): Value {
  if (args.length < 1 || args.length > 4) return err("#VALUE!");
  const refExpr = args[0];
  if (refExpr === undefined) return err("#VALUE!");
  const grid = gridOf(refExpr, host, "#REF!");
  if ("code" in grid) return grid;
  const height = grid.r1 - grid.r0 + 1;
  const width = grid.c1 - grid.c0 + 1;
  const pos = indexPos(args, host, height, width);
  if ("code" in pos) return pos;
  if (args.length === 4) {
    const area = whole(scalarAt(args[3], host));
    if (typeof area !== "number") return area;
    if (area < 1) return err("#NUM!");
    if (area !== 1) return err("#REF!");
  }
  return pick(grid, pos.row, pos.col, host);
}

function match(args: readonly Expr[], host: FnHost): Value {
  if (args.length < 2 || args.length > 3) return err("#VALUE!");
  const keyExpr = args[0];
  const rangeExpr = args[1];
  if (keyExpr === undefined || rangeExpr === undefined) return err("#VALUE!");
  const key = host.scalar(keyExpr);
  if (key.kind === "error") return key;
  const grid = gridOf(rangeExpr, host, "#VALUE!");
  if ("code" in grid) return grid;
  const cells = vector(grid, host);
  if ("code" in cells) return cells;
  const mode = args.length === 2 ? "asc" : modeOf(scalarAt(args[2], host));
  if (typeof mode !== "string") return mode;
  const hit = findIndex(cells, key, mode);
  if (hit === null) return err("#N/A");
  if (typeof hit !== "number") return hit;
  return host.number(hit + 1);
}

function indexPos(
  args: readonly Expr[],
  host: FnHost,
  height: number,
  width: number,
): { row: number; col: number } | Err {
  if (args.length === 1) return bounds(0, 0, height, width);
  const rowExpr = args[1];
  if (rowExpr === undefined) return err("#VALUE!");
  if (args.length === 2) {
    const pos = whole(host.scalar(rowExpr));
    if (typeof pos !== "number") return pos;
    if (width === 1) return bounds(pos, 0, height, width);
    if (height === 1) return bounds(0, pos, height, width);
    return bounds(pos, 0, height, width);
  }
  const colExpr = args[2];
  if (colExpr === undefined) return err("#VALUE!");
  const row = whole(host.scalar(rowExpr));
  if (typeof row !== "number") return row;
  const col = whole(host.scalar(colExpr));
  if (typeof col !== "number") return col;
  return bounds(row, col, height, width);
}

function bounds(row: number, col: number, height: number, width: number): { row: number; col: number } | Err {
  if (row !== 0 && row > height) return err("#REF!");
  if (col !== 0 && col > width) return err("#REF!");
  return { row, col };
}

function pick(grid: Grid, row: number, col: number, host: FnHost): Value {
  let r0 = grid.r0;
  let r1 = grid.r1;
  let c0 = grid.c0;
  let c1 = grid.c1;
  if (row !== 0) r0 = r1 = grid.r0 + row - 1;
  if (col !== 0) c0 = c1 = grid.c0 + col - 1;
  if (r0 !== r1 || c0 !== c1) return err("#VALUE!");
  return host.cell(grid.sheet, c0, r0);
}

function findIndex(cells: readonly Value[], key: Value, mode: Mode): number | Err | null {
  if (key.kind === "error") return key;
  if (mode === "exact") {
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell !== undefined && exactAt(cell, key)) return i;
    }
    return null;
  }
  return scan(cells, key, mode);
}

function scan(cells: readonly Value[], key: Value, mode: "asc" | "desc"): number | null {
  let loose: number | null = null;
  let equal: number | null = null;
  let matched = false;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell === undefined) continue;
    const rank = rel(cell, key);
    if (rank === "skip") continue;
    if (rank === "stop") break;
    if (mode === "asc") {
      if (rank > 0) break;
      if (rank === 0) equal = i;
      else loose = i;
      continue;
    }
    if (rank < 0) break;
    if (rank === 0) {
      equal = i;
      matched = true;
      continue;
    }
    if (matched) break;
    loose = i;
  }
  return equal ?? loose;
}

function exactAt(cell: Value, key: Value): boolean {
  if (cell.kind === "blank" || cell.kind === "error") return false;
  const kn = plainNum(key);
  if (kn !== null) {
    const cn = plainNum(cell);
    return cn !== null && near(cn, kn);
  }
  if (key.kind !== "text") return false;
  if (cell.kind === "text") return criteriaMatch(key.t, cell.t);
  if (isCriteriaRegex(key.t)) {
    const rendered = criteriaText(cell);
    return rendered !== null && criteriaMatch(key.t, rendered);
  }
  const parsed = textNum(key.t);
  const cn = plainNum(cell);
  return parsed !== null && cn !== null && near(cn, parsed);
}

function rel(cell: Value, key: Value): Rank {
  if (cell.kind === "blank") return "skip";
  if (cell.kind === "error") return "stop";
  const kn = plainNum(key);
  if (kn !== null) {
    if (cell.kind === "text") return "skip";
    const cn = plainNum(cell);
    if (cn === null) return "stop";
    return cmpNum(cn, kn);
  }
  if (key.kind !== "text") return "stop";
  if (cell.kind === "text") return cmpText(cell.t, key.t);
  const parsed = textNum(key.t);
  const cn = plainNum(cell);
  if (parsed === null || cn === null) return "stop";
  return cmpNum(cn, parsed);
}

function plainNum(value: Value): number | null {
  if (value.kind === "number") return value.n;
  if (value.kind === "bool") return value.b ? 1 : 0;
  if (value.kind === "blank") return 0;
  return null;
}

function textNum(text: string): number | null {
  const n = asNumber({ kind: "text", t: text });
  return n.kind === "number" ? n.n : null;
}

function cmpNum(left: number, right: number): -1 | 0 | 1 {
  if (near(left, right)) return 0;
  return left < right ? -1 : 1;
}

function cmpText(left: string, right: string): -1 | 0 | 1 {
  const a = left.toUpperCase();
  const b = right.toUpperCase();
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function near(a: number, b: number): boolean {
  if (a === b) return true;
  const diff = a > b ? a - b : b - a;
  const scaleA = a < 0 ? -a : a;
  const scaleB = b < 0 ? -b : b;
  return diff < scaleA * EPS || diff < scaleB * EPS;
}

function vector(grid: Grid, host: FnHost): Value[] | Err {
  const width = grid.c1 - grid.c0 + 1;
  const height = grid.r1 - grid.r0 + 1;
  if (width !== 1 && height !== 1) return err("#VALUE!");
  if (width === 1) return column(grid, grid.c0, host);
  const out: Value[] = [];
  for (let col = grid.c0; col <= grid.c1; col++) out.push(host.cell(grid.sheet, col, grid.r0));
  return out;
}

function column(grid: Grid, col: number, host: FnHost): Value[] {
  const out: Value[] = [];
  for (let row = grid.r0; row <= grid.r1; row++) out.push(host.cell(grid.sheet, col, row));
  return out;
}

function gridOf(expr: Expr, host: FnHost, missing: ErrorCode): Grid | Err {
  const arg = host.arg(expr);
  if (arg.kind === "range") return { sheet: arg.sheet, c0: arg.col0, r0: arg.row0, c1: arg.col1, r1: arg.row1 };
  return arg.value.kind === "error" ? arg.value : err(missing);
}

function modeOf(value: Value): Mode | Err {
  if (value.kind === "error") return value;
  const n = asNumber(value);
  if (n.kind === "error") return n;
  const t = Math.trunc(n.n);
  if (!Number.isSafeInteger(t)) return err("#VALUE!");
  if (t === 0) return "exact";
  if (t === 1) return "asc";
  if (t === -1) return "desc";
  return err("#VALUE!");
}

function flag(expr: Expr | undefined, host: FnHost): boolean | Err {
  if (expr === undefined) return err("#VALUE!");
  const value = host.scalar(expr);
  if (value.kind === "error") return value;
  const n = asNumber(value);
  if (n.kind === "error") return n;
  return n.n !== 0;
}

function whole(value: Value): number | Err {
  if (value.kind === "error") return value;
  const n = asNumber(value);
  if (n.kind === "error") return n;
  const t = Math.trunc(n.n);
  if (!Number.isSafeInteger(t)) return err("#VALUE!");
  if (t < 0) return err("#NUM!");
  return t;
}

function scalarAt(expr: Expr | undefined, host: FnHost): Value {
  if (expr === undefined) return err("#VALUE!");
  return host.scalar(expr);
}

function err(code: ErrorCode): Err {
  return { kind: "error", code };
}
