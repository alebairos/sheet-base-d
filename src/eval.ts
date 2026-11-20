import { parseA1 } from "./addr.js";
import { lookupFn, oneArea, type Area, type Arg, type FnHost } from "./fn.js";
import { formatNumber } from "./numfmt.js";
import { textCollation } from "./order.js";
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

export function shownCell(ctx: EvalCtx, sheet: string, col: number, row: number): Value {
  const value = computeCell(ctx, sheet, col, row);
  const input = ctx.cells.get(cellKey(sheet, col, row));
  if (input?.kind === "formula") return presentValue(value);
  return value;
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
    case "name":
      return { kind: "error", code: "#NAME?" };
    case "range":
    case "intersect":
    case "union":
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
    sheet: ctx.sheet,
    col: ctx.col,
    row: ctx.row,
  };
  return fn(args, host);
}

function scalarExpr(expr: Expr, ctx: EvalCtx): Value {
  const arg = evalArg(expr, ctx);
  if (arg.kind === "value") return arg.value;
  const area = oneArea(arg);
  if (!("code" in area)) return scalarRect(area, ctx);
  if (expr.kind === "range") {
    const own = arg.areas.find((item) => item.sheet === ctx.sheet);
    if (own !== undefined) return scalarSheetSpan(own, ctx);
  }
  return area;
}

function scalarSheetSpan(rect: Area, ctx: EvalCtx): Value {
  const oneCell = rect.col0 === rect.col1 && rect.row0 === rect.row1;
  const sharesAxis = ctx.col === rect.col0 || ctx.row === rect.row0;
  if (oneCell && !sharesAxis) return { kind: "error", code: "#VALUE!" };
  return scalarRect(rect, ctx);
}

function evalArg(expr: Expr, ctx: EvalCtx): Arg {
  if (
    expr.kind === "ref" ||
    expr.kind === "range" ||
    expr.kind === "intersect" ||
    expr.kind === "union"
  ) {
    return rectArg(expr, ctx);
  }
  return { kind: "value", value: evalExpr(expr, ctx) };
}

function rangeArg(start: CellRef, end: CellRef, ctx: EvalCtx): Arg {
  const sheetA = resolveSheet(ctx, start.sheet);
  const sheetB = resolveSheet(ctx, end.sheet);
  if (sheetA === null || (sheetB === null && start.sheet === null)) {
    return { kind: "value", value: unresolvedSheet() };
  }
  const col0 = Math.min(start.col, end.col);
  const row0 = Math.min(start.row, end.row);
  const col1 = Math.max(start.col, end.col);
  const row1 = Math.max(start.row, end.row);
  const box = { col0, row0, col1, row1 };
  if (sheetB === null) return { kind: "areas", areas: [{ sheet: sheetA, ...box }] };
  const names = Object.keys(ctx.workbook.sheets);
  const i = names.indexOf(sheetA);
  const j = names.indexOf(sheetB);
  const areas: Area[] = names.slice(Math.min(i, j), Math.max(i, j) + 1).map((sheet) => ({
    sheet,
    ...box,
  }));
  return { kind: "areas", areas };
}

function unresolvedSheet(): Err {
  return { kind: "error", code: "#NAME?" };
}

function evalRef(cell: CellRef, ctx: EvalCtx): Value {
  const sheet = resolveSheet(ctx, cell.sheet);
  if (sheet === null) return unresolvedSheet();
  return computeCell(ctx, sheet, cell.col, cell.row);
}

function intersectArg(left: Expr, right: Expr, ctx: EvalCtx): Arg {
  const a = rectArg(left, ctx);
  if (a.kind === "value") return a;
  const b = rectArg(right, ctx);
  if (b.kind === "value") return b;
  const areas: Area[] = [];
  for (const leftArea of a.areas) {
    for (const rightArea of b.areas) {
      if (leftArea.sheet !== rightArea.sheet) continue;
      const col0 = Math.max(leftArea.col0, rightArea.col0);
      const row0 = Math.max(leftArea.row0, rightArea.row0);
      const col1 = Math.min(leftArea.col1, rightArea.col1);
      const row1 = Math.min(leftArea.row1, rightArea.row1);
      if (col0 > col1 || row0 > row1) continue;
      areas.push({ sheet: leftArea.sheet, col0, row0, col1, row1 });
    }
  }
  if (areas.length === 0) return { kind: "value", value: { kind: "error", code: "#NULL!" } };
  return { kind: "areas", areas };
}

function unionArg(left: Expr, right: Expr, ctx: EvalCtx): Arg {
  const a = rectArg(left, ctx);
  if (a.kind === "value") return a;
  const b = rectArg(right, ctx);
  if (b.kind === "value") return b;
  return { kind: "areas", areas: a.areas.concat(b.areas) };
}

function rectArg(expr: Expr, ctx: EvalCtx): Arg {
  if (expr.kind === "ref") return rangeArg(expr.cell, expr.cell, ctx);
  if (expr.kind === "range") return rangeArg(expr.start, expr.end, ctx);
  if (expr.kind === "intersect") return intersectArg(expr.left, expr.right, ctx);
  if (expr.kind === "union") return unionArg(expr.left, expr.right, ctx);
  if (expr.kind === "name") return { kind: "value", value: { kind: "error", code: "#NAME?" } };
  return { kind: "value", value: { kind: "error", code: "#VALUE!" } };
}

function scalarRect(rect: Area, ctx: EvalCtx): Value {
  const hit = scalarRangeCell(
    rect.col0,
    rect.row0,
    rect.col1,
    rect.row1,
    ctx.col,
    ctx.row,
    rect.sheet === ctx.sheet,
  );
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
  blockOwnColumn: boolean,
): { col: number; row: number } | null {
  if (c1 === c2 && r1 === r2) return { col: c1, row: r1 };
  if (c1 !== c2 && r1 !== r2) return null;
  if (c1 === c2) {
    if ((blockOwnColumn && col === c1) || row < r1 || row > r2) return null;
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
  if (left.kind === "blank" && right.kind === "text") left = { kind: "text", t: "" };
  if (right.kind === "blank" && left.kind === "text") right = { kind: "text", t: "" };
  if ((op === "=" || op === "<>") && left.kind === "text" && right.kind === "text") {
    const same = left.t === right.t;
    return { kind: "bool", b: op === "=" ? same : !same };
  }
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
  if (left.kind === "text" && right.kind === "text") {
    return { kind: "number", n: textCollation(left.t, right.t) };
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

function parseNumericText(raw: string): number | null {
  const hadLeadingSpace = /^\s/.test(raw);
  const t = raw.trim().replaceAll("\u2212", "-");
  if (t === "") return null;
  const word = t.toUpperCase();
  if (word === "TRUE") return 1;
  if (word === "FALSE") return 0;

  let text = t;
  let negative = false;
  let hadDollar = false;
  let percentOutside = false;
  const signBeforeDollar = /^([+-])\$/.exec(text);
  if (signBeforeDollar !== null) text = text.slice(1);
  if (text.startsWith("$")) {
    hadDollar = true;
    text = text.slice(1);
    text = text.replace(/^ +/, "");
  }
  if (text.startsWith("(")) {
    const outsidePercent = /^(.*\)) *% *$/.exec(text);
    const inside = outsidePercent?.[1];
    if (inside !== undefined) {
      percentOutside = true;
      text = inside;
    }
  }
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
    if (!hadDollar && text.startsWith("$")) {
      hadDollar = true;
      text = text.slice(1);
      text = text.replace(/^ +/, "");
    }
  }
  if (!hadDollar && text.endsWith("$")) {
    hadDollar = true;
    text = text.slice(0, -1);
  }
  if (percentOutside) text += "%";
  const leadingSign = signBeforeDollar?.[1];
  if (leadingSign !== undefined) text = leadingSign + text;

  const match =
    /^([+-]\s*)?((?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(%)?$/.exec(
      text,
    );
  if (match !== null) {
    const sign = match[1]?.charAt(0) ?? "";
    const body = match[2];
    const percent = match[3];
    if (body === undefined) return null;
    const scientific = /[eE]/.test(body);
    if (negative && sign !== "") return null;
    if (percent === "%" && (hadDollar || (negative && !percentOutside))) return null;
    if (scientific && (hadDollar || percent === "%")) return null;
    const n = Number(sign + body.replace(/,/g, ""));
    if (n === Infinity || n === -Infinity) return Number.MAX_VALUE;
    if (!Number.isFinite(n)) return null;
    const scaled = percent === "%" ? n / 100 : n;
    return negative ? -scaled : scaled;
  }

  const frac = /^([+-]\s*)?(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (frac === null || hadLeadingSpace || hadDollar) return null;
  const sign = frac[1]?.charAt(0) ?? "";
  if (negative && sign !== "") return null;
  const whole = frac[2];
  const numer = frac[3];
  const denom = frac[4];
  if (whole === undefined || numer === undefined || denom === undefined) return null;
  const den = Number(denom);
  if (den === 0) return null;
  const mag = Number(whole) + Number(numer) / den;
  if (!Number.isFinite(mag)) return null;
  const signed = sign === "-" ? -mag : mag;
  return negative ? -signed : signed;
}

function finiteNumber(n: number): Value {
  if (!Number.isFinite(n)) return { kind: "error", code: "#NUM!" };
  return { kind: "number", n: snap(n) };
}

// Arithmetic keeps the binary value. Rounding to 15 significant digits happens
// only when a formula result is published, so SQRT(2)^2 still lands on 2.
function snap(n: number): number {
  if (n === 0) return 0;
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return n;
  const nearest = Math.round(n);
  if (approxEqual(n, nearest) || approxEqual(nearest, n)) return nearest;
  return n;
}

export function presentValue(value: Value): Value {
  if (value.kind !== "number") return value;
  const n = normalize(value.n);
  return n === value.n ? value : { kind: "number", n };
}

function normalize(n: number): number {
  const snapped = snap(n);
  if (snapped === 0 || (Number.isInteger(snapped) && Math.abs(snapped) < 1e16)) return snapped;
  const rounded = roundSig(snapped, 15);
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
  if (Number.isSafeInteger(a) && Number.isSafeInteger(b)) return false;
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
