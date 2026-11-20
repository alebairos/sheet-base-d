import { parseA1 } from "./addr.js";
import { lookupFn, type Arg, type FnHost } from "./fn.js";
import { parseFormula, type BinOp, type CellRef, type Expr } from "./parse.js";
import type { ErrorCode, Value } from "./value.js";
import type { InputCell, Workbook } from "./workbook.js";

type Num = { kind: "number"; n: number };
type Err = { kind: "error"; code: ErrorCode };
type NumOrErr = Num | Err;

const EPS = 1 / (16777216 * 16777216);

export type EvalCtx = {
  workbook: Workbook;
  sheet: string;
  col: number;
  row: number;
  cache: Map<string, Value>;
  visiting: Set<string>;
  cells: Map<string, InputCell>;
};

export function cellKey(sheet: string, col: number, row: number): string {
  return `${sheet}!${col},${row}`;
}

export function createEvalCtx(workbook: Workbook): EvalCtx {
  const cells = new Map<string, InputCell>();
  for (const [sheet, table] of Object.entries(workbook.sheets)) {
    for (const [key, cell] of Object.entries(table)) {
      const addr = parseA1(key);
      if (addr === null) continue;
      cells.set(cellKey(sheet, addr.col, addr.row), cell);
    }
  }
  return {
    workbook,
    sheet: "",
    col: 0,
    row: 0,
    cache: new Map(),
    visiting: new Set(),
    cells,
  };
}

export function resolveSheet(ctx: EvalCtx, name: string | null): string | null {
  const raw = name ?? ctx.sheet;
  const sheets = ctx.workbook.sheets;
  if (Object.hasOwn(sheets, raw)) return raw;
  const lower = raw.toLowerCase();
  let found: string | null = null;
  for (const key of Object.keys(sheets)) {
    if (key.toLowerCase() !== lower) continue;
    if (found !== null) return null;
    found = key;
  }
  return found;
}

export function computeCell(ctx: EvalCtx, sheet: string, col: number, row: number): Value {
  const key = cellKey(sheet, col, row);
  const cached = ctx.cache.get(key);
  if (cached !== undefined) return cached;
  if (ctx.visiting.has(key)) return { kind: "error", code: "#CIRC!" };
  const input = ctx.cells.get(key);
  if (input === undefined) {
    const blank: Value = { kind: "blank" };
    ctx.cache.set(key, blank);
    return blank;
  }
  if (input.kind !== "formula") {
    ctx.cache.set(key, input);
    return input;
  }
  ctx.visiting.add(key);
  const stored = evalFormula(input.src, { ...ctx, sheet, col, row });
  ctx.visiting.delete(key);
  ctx.cache.set(key, stored);
  return stored;
}

function formulaResult(value: Value): Value {
  if (value.kind === "blank") return { kind: "number", n: 0 };
  return value;
}

export function evalUnindexed(ctx: EvalCtx, sheet: string, cell: InputCell): Value {
  if (cell.kind !== "formula") return cell;
  return evalFormula(cell.src, { ...ctx, sheet, col: -1, row: -1 });
}

function evalFormula(src: string, ctx: EvalCtx): Value {
  const parsed = parseFormula(src);
  if (parsed.kind === "error") return parsed;
  return formulaResult(evalExpr(parsed.expr, ctx));
}

export function evalExpr(expr: Expr, ctx: EvalCtx): Value {
  switch (expr.kind) {
    case "number":
      return finiteNumber(expr.n);
    case "text":
      return expr;
    case "bool":
      return expr;
    case "blank":
      return expr;
    case "unary":
      return evalUnary(expr.op, evalExpr(expr.arg, ctx));
    case "binary":
      return evalBinary(expr.op, evalExpr(expr.left, ctx), evalExpr(expr.right, ctx));
    case "call":
      return evalCall(expr.name, expr.args, ctx);
    case "ref":
      return evalRef(expr.cell, ctx);
    case "range":
    case "intersect":
      return scalarExpr(expr, ctx);
    default: {
      const exhaustive: never = expr;
      return exhaustive;
    }
  }
}

function evalCall(name: string, args: readonly Expr[], ctx: EvalCtx): Value {
  const fn = lookupFn(name);
  if (fn === undefined) return { kind: "error", code: "#NAME?" };
  const host: FnHost = {
    arg: (expr) => evalArg(expr, ctx),
    cell: (sheet, col, row) => computeCell(ctx, sheet, col, row),
    number: finiteNumber,
    scalar: (expr) => scalarExpr(expr, ctx),
    col: ctx.col,
    row: ctx.row,
  };
  return fn(args, host);
}

function scalarExpr(expr: Expr, ctx: EvalCtx): Value {
  const arg = evalArg(expr, ctx);
  if (arg.kind === "value") return arg.value;
  return scalarRect(arg, ctx);
}

function evalArg(expr: Expr, ctx: EvalCtx): Arg {
  if (expr.kind === "ref" || expr.kind === "range" || expr.kind === "intersect") return rectArg(expr, ctx);
  return { kind: "value", value: evalExpr(expr, ctx) };
}

function rangeArg(start: CellRef, end: CellRef, ctx: EvalCtx): Arg {
  const sheetA = resolveSheet(ctx, start.sheet);
  const sheetB = resolveSheet(ctx, end.sheet);
  if (sheetA === null || sheetB === null) return { kind: "value", value: { kind: "error", code: "#REF!" } };
  if (sheetA !== sheetB) return { kind: "value", value: { kind: "error", code: "#VALUE!" } };
  return {
    kind: "range",
    sheet: sheetA,
    col0: Math.min(start.col, end.col),
    row0: Math.min(start.row, end.row),
    col1: Math.max(start.col, end.col),
    row1: Math.max(start.row, end.row),
  };
}

function evalRef(cell: CellRef, ctx: EvalCtx): Value {
  const sheet = resolveSheet(ctx, cell.sheet);
  if (sheet === null) return { kind: "error", code: "#REF!" };
  return computeCell(ctx, sheet, cell.col, cell.row);
}

function intersectArg(left: Expr, right: Expr, ctx: EvalCtx): Arg {
  const a = rectArg(left, ctx);
  if (a.kind === "value") return a;
  const b = rectArg(right, ctx);
  if (b.kind === "value") return b;
  if (a.sheet !== b.sheet) return { kind: "value", value: { kind: "error", code: "#VALUE!" } };
  const col0 = Math.max(a.col0, b.col0);
  const row0 = Math.max(a.row0, b.row0);
  const col1 = Math.min(a.col1, b.col1);
  const row1 = Math.min(a.row1, b.row1);
  if (col0 > col1 || row0 > row1) return { kind: "value", value: { kind: "error", code: "#NULL!" } };
  return { kind: "range", sheet: a.sheet, col0, row0, col1, row1 };
}

function rectArg(expr: Expr, ctx: EvalCtx): Arg {
  if (expr.kind === "ref") return rangeArg(expr.cell, expr.cell, ctx);
  if (expr.kind === "range") return rangeArg(expr.start, expr.end, ctx);
  if (expr.kind === "intersect") return intersectArg(expr.left, expr.right, ctx);
  return { kind: "value", value: { kind: "error", code: "#VALUE!" } };
}

function scalarRect(rect: Extract<Arg, { kind: "range" }>, ctx: EvalCtx): Value {
  const hit = scalarRangeCell(rect.col0, rect.row0, rect.col1, rect.row1, ctx.col, ctx.row);
  if (hit === null) return { kind: "error", code: "#VALUE!" };
  return computeCell(ctx, rect.sheet, hit.col, hit.row);
}

export function scalarRangeCell(
  c1: number,
  r1: number,
  c2: number,
  r2: number,
  col: number,
  row: number,
): { col: number; row: number } | null {
  if (c1 === c2 && r1 === r2) return { col: c1, row: r1 };
  if (c1 !== c2 && r1 !== r2) return null;
  if (c1 === c2) {
    if (col === c1 || row < r1 || row > r2) return null;
    return { col: c1, row };
  }
  if (col < c1 || col > c2) return null;
  return { col, row: r1 };
}

function evalUnary(op: "-" | "%", arg: Value): Value {
  if (arg.kind === "error") return arg;
  const n = asNumber(arg);
  if (n.kind === "error") return n;
  if (op === "%") return finiteNumber(n.n / 100);
  return finiteNumber(-n.n);
}

function evalBinary(op: BinOp, left: Value, right: Value): Value {
  if (left.kind === "error") return left;
  if (right.kind === "error") return right;
  switch (op) {
    case "+":
      return num2(left, right, (a, b) => approxAdd(a, b));
    case "-":
      return num2(left, right, (a, b) => approxSub(a, b));
    case "*":
      return num2(left, right, (a, b) => a * b);
    case "/":
      return divide(left, right);
    case "^":
      return num2(left, right, (a, b) => raise(a, b));
    case "&":
      return concat(left, right);
    case "=":
    case "<>":
    case "<":
    case ">":
    case "<=":
    case ">=":
      return compare(op, left, right);
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

function num2(left: Value, right: Value, fn: (a: number, b: number) => number): Value {
  const l = asNumber(left);
  if (l.kind === "error") return l;
  const r = asNumber(right);
  if (r.kind === "error") return r;
  return finiteNumber(fn(l.n, r.n));
}

function divide(left: Value, right: Value): Value {
  const l = asNumber(left);
  if (l.kind === "error") return l;
  const r = asNumber(right);
  if (r.kind === "error") return r;
  if (r.n === 0) return { kind: "error", code: "#DIV/0!" };
  return finiteNumber(l.n / r.n);
}

export function raise(base: number, exp: number): number {
  if (exp === 0) return 1;
  if (base === 0) return exp > 0 ? 0 : Number.NaN;
  if (base < 0) {
    const rounded = Math.round(exp);
    if (approxEqual(exp, rounded)) return base ** rounded;
    const root = unitOddRoot(exp);
    if (root === null) return Number.NaN;
    const mag = Math.abs(base) ** (1 / root.n);
    const signed = -mag;
    return root.recip ? 1 / signed : signed;
  }
  return base ** exp;
}

function unitOddRoot(exp: number): { n: number; recip: boolean } | null {
  const recip = exp < 0;
  const abs = Math.abs(exp);
  if (abs === 0 || !Number.isFinite(abs)) return null;
  const n = Math.round(1 / abs);
  if (n < 1 || n % 2 === 0) return null;
  const product = abs * n;
  if (!approxEqual(product, 1) && !approxEqual(1, product)) return null;
  return { n, recip };
}

function concat(left: Value, right: Value): Value {
  const l = asText(left);
  if (l.kind === "error") return l;
  const r = asText(right);
  if (r.kind === "error") return r;
  return { kind: "text", t: l.t + r.t };
}

function compare(op: "=" | "<>" | "<" | ">" | "<=" | ">=", left: Value, right: Value): Value {
  const ord = order(left, right);
  if (ord.kind === "error") return ord;
  const c = ord.n;
  let b = false;
  switch (op) {
    case "=":
      b = c === 0;
      break;
    case "<>":
      b = c !== 0;
      break;
    case "<":
      b = c < 0;
      break;
    case ">":
      b = c > 0;
      break;
    case "<=":
      b = c <= 0;
      break;
    case ">=":
      b = c >= 0;
      break;
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
  return { kind: "bool", b };
}

function order(left: Value, right: Value): NumOrErr {
  if (left.kind === "blank" && right.kind === "text") left = { kind: "text", t: "" };
  if (right.kind === "blank" && left.kind === "text") right = { kind: "text", t: "" };
  if (left.kind === "text" && right.kind === "text") {
    return { kind: "number", n: cmpText(left.t, right.t) };
  }
  if (left.kind === "text") return { kind: "number", n: 1 };
  if (right.kind === "text") return { kind: "number", n: -1 };
  const l = asNumber(left);
  if (l.kind === "error") return l;
  const r = asNumber(right);
  if (r.kind === "error") return r;
  if (approxEqual(l.n, r.n) || approxEqual(r.n, l.n)) return { kind: "number", n: 0 };
  return { kind: "number", n: l.n < r.n ? -1 : 1 };
}

export function asNumber(value: Value): NumOrErr {
  switch (value.kind) {
    case "number":
      return value;
    case "bool":
      return { kind: "number", n: value.b ? 1 : 0 };
    case "blank":
      return { kind: "number", n: 0 };
    case "error":
      return value;
    case "text": {
      const n = parseNumericText(value.t);
      if (n === null) return { kind: "error", code: "#VALUE!" };
      return { kind: "number", n };
    }
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

export function asText(value: Value): { kind: "text"; t: string } | Err {
  switch (value.kind) {
    case "text":
      return value;
    case "blank":
      return { kind: "text", t: "" };
    case "bool":
      return { kind: "text", t: value.b ? "1" : "0" };
    case "number":
      return { kind: "text", t: formatNumber(value.n) };
    case "error":
      return value;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function cmpText(left: string, right: string): -1 | 0 | 1 {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  if (left === right) return 0;
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const a = left.charAt(i);
    const b = right.charAt(i);
    if (a === b) continue;
    const rank = caseRank(a) - caseRank(b);
    if (rank !== 0) return rank < 0 ? -1 : 1;
    return a < b ? -1 : 1;
  }
  if (left.length < right.length) return -1;
  if (left.length > right.length) return 1;
  return 0;
}

function caseRank(ch: string): number {
  const lower = ch.toLowerCase();
  const upper = ch.toUpperCase();
  if (ch === lower && ch !== upper) return 0;
  if (ch === upper && ch !== lower) return 1;
  return 2;
}

function parseNumericText(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const word = t.toUpperCase();
  if (word === "TRUE") return 1;
  if (word === "FALSE") return 0;
  const match = /^([+-])?\s*((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(%)?$/.exec(t);
  if (match === null) return null;
  const sign = match[1] ?? "";
  const body = match[2];
  const percent = match[3];
  if (body === undefined) return null;
  const n = Number(sign + body);
  if (!Number.isFinite(n)) return null;
  return percent === "%" ? n / 100 : n;
}

function formatNumber(n: number): string {
  if (n === 0) return "0";
  const neg = n < 0;
  const abs = Math.abs(n);
  const body = abs >= 1e16 || abs < 1e-14 ? formatSci(abs) : formatFixed(abs);
  return neg ? `-${body}` : body;
}

function formatSci(abs: number): string {
  let exp = Math.floor(Math.log10(abs));
  let mant = abs / 10 ** exp;
  if (mant >= 10) {
    mant /= 10;
    exp += 1;
  } else if (mant < 1) {
    mant *= 10;
    exp -= 1;
  }
  let s = mant.toPrecision(15);
  if (/[eE]/.test(s)) s = String(Number(s));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  const sign = exp < 0 ? "-" : "+";
  const digits = String(Math.abs(exp)).padStart(3, "0");
  return `${s}E${sign}${digits}`;
}

function formatFixed(abs: number): string {
  const s = abs.toPrecision(15);
  if (!/[eE]/.test(s)) {
    if (!s.includes(".")) return s;
    return s.replace(/0+$/, "").replace(/\.$/, "");
  }
  const match = /^(\d(?:\.\d+)?)[eE]([+-]?\d+)$/.exec(s);
  if (match === null) return s;
  const mantissa = match[1];
  const expText = match[2];
  if (mantissa === undefined || expText === undefined) return s;
  const digits = mantissa.replace(".", "");
  const exp = Number(expText);
  if (exp >= 0) {
    const width = exp + 1;
    if (digits.length <= width) return digits.padEnd(width, "0");
    const whole = digits.slice(0, width);
    const frac = digits.slice(width).replace(/0+$/, "");
    return frac.length === 0 ? whole : `${whole}.${frac}`;
  }
  const frac = digits.replace(/0+$/, "");
  return `0.${"0".repeat(-exp - 1)}${frac}`;
}

function finiteNumber(n: number): Value {
  if (!Number.isFinite(n)) return { kind: "error", code: "#NUM!" };
  return { kind: "number", n: normalize(n) };
}

function normalize(n: number): number {
  if (n === 0) return 0;
  const rounded = roundSig(n, 15);
  const nearest = Math.round(rounded);
  if (approxEqual(rounded, nearest) || approxEqual(nearest, rounded)) return nearest;
  return rounded;
}

function roundSig(n: number, digits: number): number {
  if (n === 0) return 0;
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  let exp = Math.floor(Math.log10(abs));
  const base = 10 ** exp;
  if (Number.isFinite(base) && base !== 0) {
    const mant = abs / base;
    if (mant >= 10) exp += 1;
    else if (mant < 1) exp -= 1;
  }
  const pow = 10 ** (digits - 1 - exp);
  if (!Number.isFinite(pow) || pow === 0) return n;
  let rounded = Math.round(abs * pow) / pow;
  if (!Number.isFinite(rounded)) return n;
  if (rounded !== 0) {
    const exp2 = Math.floor(Math.log10(rounded));
    if (exp2 !== exp) {
      const pow2 = 10 ** (digits - 1 - exp2);
      if (Number.isFinite(pow2) && pow2 !== 0) rounded = Math.round(rounded * pow2) / pow2;
    }
  }
  return sign * (rounded === 0 ? 0 : rounded);
}

function approxEqual(a: number, b: number): boolean {
  if (a === b) return true;
  const diff = a - b;
  const ad = diff < 0 ? -diff : diff;
  const scale = a < 0 ? -a : a;
  return ad < scale * EPS;
}

function approxAdd(a: number, b: number): number {
  if (a === 0) return b;
  if (b === 0) return a;
  if (a < 0 !== b < 0) return approxSub(a, -b);
  return a + b;
}

function approxSub(a: number, b: number): number {
  if (approxEqual(a, b)) return 0;
  return a - b;
}
