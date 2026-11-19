import { asNumber, raise } from "./eval.js";
import type { Expr } from "./parse.js";
import type { ErrorCode, Value } from "./value.js";

export type Arg =
  | { kind: "value"; value: Value }
  | {
      kind: "range";
      sheet: string;
      col0: number;
      row0: number;
      col1: number;
      row1: number;
    };

export type FnHost = {
  arg(expr: Expr): Arg;
  cell(sheet: string, col: number, row: number): Value;
  number(n: number): Value;
};

export type Fn = (args: readonly Expr[], host: FnHost) => Value;

type RangeArg = Extract<Arg, { kind: "range" }>;
type NumOrErr = { kind: "number"; n: number } | { kind: "error"; code: ErrorCode };
type Op = "eq" | "ne" | "lt" | "le" | "gt" | "ge";
type RoundMode = "half" | "up" | "down";

type Crit =
  | { kind: "error"; code: ErrorCode }
  | { kind: "num"; op: Op; n: number; textAlso: boolean; text: string }
  | { kind: "blankEq" }
  | { kind: "blankOrEmpty" }
  | { kind: "nonBlank" }
  | { kind: "emptyText"; op: "gt" | "ge" | "lt" | "le" }
  | { kind: "text"; op: Op; t: string; wild: RegExp | null };

const EPS = 1 / (16777216 * 16777216);

const FNS: { readonly [name: string]: Fn } = {
  SUM: sum,
  AVERAGE: average,
  MIN: (args, host) => extreme(args, host, "min"),
  MAX: (args, host) => extreme(args, host, "max"),
  COUNT: count,
  COUNTA: counta,
  ROUND: (args, host) => round(args, host, "half"),
  ROUNDUP: (args, host) => round(args, host, "up"),
  ROUNDDOWN: (args, host) => round(args, host, "down"),
  INT: intFn,
  MOD: mod,
  ABS: abs,
  POWER: power,
  SQRT: sqrt,
  PRODUCT: product,
  SUMIF: sumif,
  COUNTIF: countif,
  AVERAGEIF: averageif,
  MEDIAN: median,
  STDEV: stdev,
};

export function lookupFn(name: string): Fn | undefined {
  return FNS[name];
}

function sum(args: readonly Expr[], host: FnHost): Value {
  let total = 0;
  for (const expr of args) {
    const next = addArg(total, host.arg(expr), host);
    if (next.kind === "error") return next;
    total = next.n;
  }
  return host.number(total);
}

function addArg(total: number, arg: Arg, host: FnHost): NumOrErr {
  if (arg.kind === "value") return asNum(addScalar(total, arg.value, host));
  for (let row = arg.row0; row <= arg.row1; row++) {
    for (let col = arg.col0; col <= arg.col1; col++) {
      const part = sumCell(host.cell(arg.sheet, col, row));
      if (part === null) continue;
      if (part.kind === "error") return part;
      const next = asNum(host.number(total + part.n));
      if (next.kind === "error") return next;
      total = next.n;
    }
  }
  return asNum(host.number(total));
}

function addScalar(total: number, value: Value, host: FnHost): Value {
  switch (value.kind) {
    case "error":
      return value;
    case "text":
      return host.number(total);
    case "number":
      return host.number(total + value.n);
    case "blank":
      return host.number(total);
    case "bool":
      return host.number(total + (value.b ? 1 : 0));
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function sumCell(value: Value): NumOrErr | null {
  switch (value.kind) {
    case "number":
      return value;
    case "bool":
      return { kind: "number", n: value.b ? 1 : 0 };
    case "blank":
    case "text":
      return null;
    case "error":
      return value;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function asNum(value: Value): NumOrErr {
  if (value.kind === "number") return value;
  if (value.kind === "error") return value;
  return { kind: "error", code: "#VALUE!" };
}

function visit(
  args: readonly Expr[],
  host: FnHost,
  fn: (value: Value, fromRange: boolean) => boolean,
): void {
  for (const expr of args) {
    const arg = host.arg(expr);
    if (arg.kind === "value") {
      if (!fn(arg.value, false)) return;
      continue;
    }
    for (let row = arg.row0; row <= arg.row1; row++) {
      for (let col = arg.col0; col <= arg.col1; col++) {
        if (!fn(host.cell(arg.sheet, col, row), true)) return;
      }
    }
  }
}

function collectNumbers(args: readonly Expr[], host: FnHost): number[] | Value {
  const out: number[] = [];
  let error: Value | null = null;
  visit(args, host, (value, fromRange) => {
    const next = takeNumber(value, fromRange);
    if (next.kind === "error") {
      error = next;
      return false;
    }
    if (next.kind === "number") out.push(next.n);
    return true;
  });
  return error ?? out;
}

function takeNumber(value: Value, fromRange: boolean): NumOrErr | { kind: "skip" } {
  switch (value.kind) {
    case "error":
      return value;
    case "number":
      return value;
    case "bool":
      return { kind: "number", n: value.b ? 1 : 0 };
    case "blank":
      return fromRange ? { kind: "skip" } : { kind: "number", n: 0 };
    case "text":
      return fromRange ? { kind: "skip" } : { kind: "error", code: "#VALUE!" };
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function average(args: readonly Expr[], host: FnHost): Value {
  const xs = collectNumbers(args, host);
  if (!Array.isArray(xs)) return xs;
  if (xs.length === 0) return { kind: "error", code: "#DIV/0!" };
  let total = 0;
  for (const n of xs) total += n;
  return host.number(total / xs.length);
}

function product(args: readonly Expr[], host: FnHost): Value {
  const xs = collectNumbers(args, host);
  if (!Array.isArray(xs)) return xs;
  if (xs.length === 0) return host.number(0);
  let total = 1;
  for (const n of xs) {
    const next = host.number(total * n);
    if (next.kind !== "number") return next;
    total = next.n;
  }
  return host.number(total);
}

function median(args: readonly Expr[], host: FnHost): Value {
  const xs = collectNumbers(args, host);
  if (!Array.isArray(xs)) return xs;
  if (xs.length === 0) return { kind: "error", code: "#VALUE!" };
  xs.sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  const upper = xs[mid];
  if (upper === undefined) return { kind: "error", code: "#VALUE!" };
  if (xs.length % 2 === 1) return host.number(upper);
  const lower = xs[mid - 1];
  if (lower === undefined) return { kind: "error", code: "#VALUE!" };
  return host.number((lower + upper) / 2);
}

function stdev(args: readonly Expr[], host: FnHost): Value {
  const xs = collectNumbers(args, host);
  if (!Array.isArray(xs)) return xs;
  if (xs.length < 2) return { kind: "error", code: "#DIV/0!" };
  let sum = 0;
  for (const n of xs) sum += n;
  const mean = sum / xs.length;
  let acc = 0;
  for (const n of xs) {
    const d = n - mean;
    acc += d * d;
  }
  if (acc < 0) acc = 0;
  return host.number(Math.sqrt(acc / (xs.length - 1)));
}

function count(args: readonly Expr[], host: FnHost): Value {
  let n = 0;
  visit(args, host, (value, fromRange) => {
    if (countOne(value, fromRange)) n += 1;
    return true;
  });
  return host.number(n);
}

function countOne(value: Value, fromRange: boolean): boolean {
  switch (value.kind) {
    case "number":
    case "bool":
      return true;
    case "blank":
      return !fromRange;
    case "error":
      return false;
    case "text":
      return !fromRange && asNumber(value).kind === "number";
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function counta(args: readonly Expr[], host: FnHost): Value {
  let n = 0;
  visit(args, host, (value, fromRange) => {
    if (value.kind !== "blank" || !fromRange) n += 1;
    return true;
  });
  return host.number(n);
}

function extreme(args: readonly Expr[], host: FnHost, mode: "min" | "max"): Value {
  if (args.length === 0) return { kind: "error", code: "#VALUE!" };
  const state: { best: { n: number; value: Value } | null; error: Value | null } = {
    best: null,
    error: null,
  };
  visit(args, host, (value, fromRange) => {
    if (value.kind === "error") {
      state.error = value;
      return false;
    }
    if (value.kind === "text") {
      if (!fromRange) {
        state.error = { kind: "error", code: "#VALUE!" };
        return false;
      }
      return true;
    }
    const taken = extremeValue(value, fromRange);
    if (taken === null) return true;
    const best = state.best;
    if (best === null || (mode === "min" ? lower(taken.n, best.n) : lower(best.n, taken.n))) {
      state.best = taken;
    }
    return true;
  });
  if (state.error) return state.error;
  const chosen = state.best;
  if (chosen === null) return host.number(0);
  return chosen.value;
}

function extremeValue(value: Value, fromRange: boolean): { n: number; value: Value } | null {
  if (value.kind === "number") return { n: value.n, value };
  if (value.kind === "bool") return { n: value.b ? 1 : 0, value };
  if (value.kind === "blank" && !fromRange) return { n: 0, value: { kind: "number", n: 0 } };
  return null;
}

function lower(a: number, b: number): boolean {
  return a < b && !near(a, b);
}

function round(args: readonly Expr[], host: FnHost, mode: RoundMode): Value {
  if (args.length < 1 || args.length > 2) return { kind: "error", code: "#VALUE!" };
  const first = args[0];
  if (first === undefined) return { kind: "error", code: "#VALUE!" };
  const n = scalarNumber(first, host);
  if (n.kind === "error") return n;
  let digits = 0;
  if (args.length === 2) {
    const second = args[1];
    if (second === undefined) return { kind: "error", code: "#VALUE!" };
    const d = scalarNumber(second, host);
    if (d.kind === "error") return d;
    digits = d.n < 0 ? Math.ceil(d.n) : Math.floor(d.n);
  }
  return host.number(applyRound(n.n, digits, mode));
}

function applyRound(n: number, digits: number, mode: RoundMode): number {
  if (n === 0) return 0;
  const sign = n < 0 ? -1 : 1;
  const shifted = scaledAbs(n, digits);
  const floor = Math.floor(shifted);
  let mag = floor;
  if (mode === "half") mag = Math.round(shifted);
  else if (mode === "up" && shifted !== floor) mag = floor + 1;
  const out = sign * unscale(mag, digits);
  return out === 0 ? 0 : out;
}

function scaledAbs(n: number, digits: number): number {
  const parts = Math.abs(n).toExponential().split("e");
  const mant = parts[0];
  const exp = parts[1];
  if (mant === undefined || exp === undefined) return Math.abs(n);
  return Number(mant + "e" + (Number(exp) + digits));
}

function unscale(mag: number, digits: number): number {
  if (mag === 0) return 0;
  const parts = Math.abs(mag).toExponential().split("e");
  const mant = parts[0];
  const exp = parts[1];
  if (mant === undefined || exp === undefined) return mag;
  return Number(mant + "e" + (Number(exp) - digits));
}

function intFn(args: readonly Expr[], host: FnHost): Value {
  const n = oneNumber(args, host);
  if (n.kind === "error") return n;
  return host.number(Math.floor(n.n));
}

function mod(args: readonly Expr[], host: FnHost): Value {
  const pair = twoNumbers(args, host);
  if (pair.kind === "error") return pair;
  if (pair.b === 0) return { kind: "error", code: "#DIV/0!" };
  return host.number(modCalc(pair.a, pair.b));
}

function modCalc(n: number, d: number): number {
  let q = n / d;
  const nearest = Math.round(q);
  if (near(q, nearest)) q = nearest;
  else q = Math.floor(q);
  if (near(n, d * q)) return 0;
  const r = n - d * q;
  return r === 0 ? 0 : r;
}

function abs(args: readonly Expr[], host: FnHost): Value {
  const n = oneNumber(args, host);
  if (n.kind === "error") return n;
  return host.number(Math.abs(n.n));
}

function power(args: readonly Expr[], host: FnHost): Value {
  const pair = twoNumbers(args, host);
  if (pair.kind === "error") return pair;
  return host.number(raise(pair.a, pair.b));
}

function sqrt(args: readonly Expr[], host: FnHost): Value {
  const n = oneNumber(args, host);
  if (n.kind === "error") return n;
  if (n.n < 0) return { kind: "error", code: "#VALUE!" };
  return host.number(Math.sqrt(n.n));
}

function oneNumber(args: readonly Expr[], host: FnHost): NumOrErr {
  if (args.length !== 1) return { kind: "error", code: "#VALUE!" };
  const expr = args[0];
  if (expr === undefined) return { kind: "error", code: "#VALUE!" };
  return scalarNumber(expr, host);
}

function twoNumbers(
  args: readonly Expr[],
  host: FnHost,
): { kind: "pair"; a: number; b: number } | { kind: "error"; code: ErrorCode } {
  if (args.length !== 2) return { kind: "error", code: "#VALUE!" };
  const left = args[0];
  const right = args[1];
  if (left === undefined || right === undefined) return { kind: "error", code: "#VALUE!" };
  const a = scalarNumber(left, host);
  if (a.kind === "error") return a;
  const b = scalarNumber(right, host);
  if (b.kind === "error") return b;
  return { kind: "pair", a: a.n, b: b.n };
}

function scalarNumber(expr: Expr, host: FnHost): NumOrErr {
  const value = scalarValue(expr, host);
  if (value.kind === "error") return value;
  return asNumber(value);
}

function scalarValue(expr: Expr, host: FnHost): Value {
  const arg = host.arg(expr);
  if (arg.kind === "value") return arg.value;
  if (arg.col0 === arg.col1 && arg.row0 === arg.row1) return host.cell(arg.sheet, arg.col0, arg.row0);
  return { kind: "error", code: "#VALUE!" };
}

function sumif(args: readonly Expr[], host: FnHost): Value {
  const framed = frame(args, host, true);
  if (framed.kind === "error") return framed;
  let total = 0;
  let bad: Value | null = null;
  eachMatch(framed.range, framed.anchor, framed.crit, host, (value) => {
    if (value.kind === "error") {
      bad = value;
      return false;
    }
    if (value.kind === "number") total += value.n;
    else if (value.kind === "bool") total += value.b ? 1 : 0;
    return true;
  });
  if (bad) return bad;
  return host.number(total);
}

function averageif(args: readonly Expr[], host: FnHost): Value {
  const framed = frame(args, host, true);
  if (framed.kind === "error") return framed;
  let total = 0;
  let n = 0;
  let bad: Value | null = null;
  eachMatch(framed.range, framed.anchor, framed.crit, host, (value) => {
    if (value.kind === "error") {
      bad = value;
      return false;
    }
    if (value.kind === "number") {
      total += value.n;
      n += 1;
    } else if (value.kind === "bool") {
      total += value.b ? 1 : 0;
      n += 1;
    }
    return true;
  });
  if (bad) return bad;
  if (n === 0) return { kind: "error", code: "#DIV/0!" };
  return host.number(total / n);
}

function countif(args: readonly Expr[], host: FnHost): Value {
  const framed = frame(args, host, false);
  if (framed.kind === "error") return framed;
  let n = 0;
  eachMatch(framed.range, framed.range, framed.crit, host, () => {
    n += 1;
    return true;
  });
  return host.number(n);
}

function frame(
  args: readonly Expr[],
  host: FnHost,
  allowSum: boolean,
): { kind: "ok"; range: RangeArg; anchor: RangeArg; crit: Crit } | { kind: "error"; code: ErrorCode } {
  const max = allowSum ? 3 : 2;
  if (args.length < 2 || args.length > max) return { kind: "error", code: "#VALUE!" };
  const rangeExpr = args[0];
  const critExpr = args[1];
  if (rangeExpr === undefined || critExpr === undefined) return { kind: "error", code: "#VALUE!" };
  const range = asRange(rangeExpr, host);
  if (range.kind !== "range") return range;
  const crit = criteriaFrom(critExpr, host);
  if (crit.kind === "error") return crit;
  let anchor = range;
  if (allowSum && args.length === 3) {
    const sumExpr = args[2];
    if (sumExpr === undefined) return { kind: "error", code: "#VALUE!" };
    const sumRange = asRange(sumExpr, host);
    if (sumRange.kind !== "range") return sumRange;
    anchor = sumRange;
  }
  return { kind: "ok", range, anchor, crit };
}

function eachMatch(
  range: RangeArg,
  anchor: RangeArg,
  crit: Crit,
  host: FnHost,
  fn: (value: Value) => boolean,
): void {
  const width = range.col1 - range.col0 + 1;
  const height = range.row1 - range.row0 + 1;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const cell = host.cell(range.sheet, range.col0 + c, range.row0 + r);
      if (cell.kind === "error") continue;
      if (!matches(cell, crit)) continue;
      const summed = host.cell(anchor.sheet, anchor.col0 + c, anchor.row0 + r);
      if (!fn(summed)) return;
    }
  }
}

function asRange(expr: Expr, host: FnHost): RangeArg | { kind: "error"; code: ErrorCode } {
  const arg = host.arg(expr);
  if (arg.kind === "range") return arg;
  return arg.value.kind === "error" ? arg.value : { kind: "error", code: "#VALUE!" };
}

function criteriaFrom(expr: Expr, host: FnHost): Crit {
  return parseCriteria(scalarValue(expr, host));
}

function parseCriteria(value: Value): Crit {
  switch (value.kind) {
    case "error":
      return value;
    case "blank":
      return { kind: "num", op: "eq", n: 0, textAlso: false, text: "0" };
    case "number":
      return { kind: "num", op: "eq", n: value.n, textAlso: false, text: numText(value.n) };
    case "bool":
      return {
        kind: "num",
        op: "eq",
        n: value.b ? 1 : 0,
        textAlso: false,
        text: value.b ? "TRUE" : "FALSE",
      };
    case "text":
      return parseTextCriteria(value.t);
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function parseTextCriteria(raw: string): Crit {
  const opMatch = /^(<=|>=|<>|=|<|>)(.*)$/.exec(raw);
  if (opMatch !== null) {
    const opText = opMatch[1];
    const rest = opMatch[2];
    if (opText !== undefined && rest !== undefined) return parseOperand(opOf(opText), rest.trim(), true);
  }
  return parseOperand("eq", raw, false);
}

function parseOperand(op: Op, rest: string, explicit: boolean): Crit {
  if (rest === "") return emptyCriteria(op, explicit);
  const coerced = asNumber({ kind: "text", t: rest });
  if (coerced.kind === "number") {
    return {
      kind: "num",
      op,
      n: coerced.n,
      textAlso: op === "eq" || op === "ne",
      text: rest.trim(),
    };
  }
  const wild = (op === "eq" || op === "ne") && hasWild(rest) ? wildRegExp(rest) : null;
  return { kind: "text", op, t: rest, wild };
}

function emptyCriteria(op: Op, explicit: boolean): Crit {
  if (op === "eq") return explicit ? { kind: "blankEq" } : { kind: "blankOrEmpty" };
  if (op === "ne") return { kind: "nonBlank" };
  return { kind: "emptyText", op };
}

function opOf(text: string): Op {
  switch (text) {
    case "<=":
      return "le";
    case ">=":
      return "ge";
    case "<>":
      return "ne";
    case "<":
      return "lt";
    case ">":
      return "gt";
    default:
      return "eq";
  }
}

function matches(value: Value, crit: Crit): boolean {
  switch (crit.kind) {
    case "error":
      return false;
    case "blankEq":
      return value.kind === "blank";
    case "blankOrEmpty":
      return value.kind === "blank" || (value.kind === "text" && value.t === "");
    case "nonBlank":
      return value.kind !== "blank";
    case "emptyText":
      return matchEmptyText(value, crit.op);
    case "num":
      return matchNum(value, crit);
    case "text":
      return matchText(value, crit);
    default: {
      const exhaustive: never = crit;
      return exhaustive;
    }
  }
}

function matchEmptyText(value: Value, op: "gt" | "ge" | "lt" | "le"): boolean {
  if (value.kind !== "text") return false;
  if (op === "gt") return value.t !== "";
  if (op === "ge") return true;
  if (op === "le") return value.t === "";
  return false;
}

function matchNum(value: Value, crit: Extract<Crit, { kind: "num" }>): boolean {
  const n = value.kind === "number" ? value.n : value.kind === "bool" ? (value.b ? 1 : 0) : null;
  const textHit =
    crit.textAlso && value.kind === "text" && value.t.toUpperCase() === crit.text.toUpperCase();
  const numHit = n !== null && near(n, crit.n);
  if (crit.op === "eq") return numHit || textHit;
  if (crit.op === "ne") return !(numHit || textHit);
  if (n === null) return false;
  if (crit.op === "lt") return lower(n, crit.n);
  if (crit.op === "gt") return lower(crit.n, n);
  if (crit.op === "le") return !lower(crit.n, n);
  return !lower(n, crit.n);
}

function matchText(value: Value, crit: Extract<Crit, { kind: "text" }>): boolean {
  if (crit.op === "lt" || crit.op === "gt" || crit.op === "le" || crit.op === "ge") {
    if (value.kind !== "text") return false;
    const cmp = textOrder(value.t, crit.t);
    if (crit.op === "lt") return cmp < 0;
    if (crit.op === "gt") return cmp > 0;
    if (crit.op === "le") return cmp <= 0;
    return cmp >= 0;
  }
  const rendered = renderForCriteria(value);
  const eq =
    rendered !== null &&
    (crit.wild !== null ? crit.wild.test(rendered) : rendered.toUpperCase() === crit.t.toUpperCase());
  return crit.op === "eq" ? eq : !eq;
}

function renderForCriteria(value: Value): string | null {
  switch (value.kind) {
    case "text":
      return value.t;
    case "number":
      return numText(value.n);
    case "bool":
      return value.b ? "TRUE" : "FALSE";
    case "blank":
    case "error":
      return null;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function textOrder(a: string, b: string): number {
  const left = a.toUpperCase();
  const right = b.toUpperCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function numText(n: number): string {
  if (n === 0) return "0";
  return String(n);
}

function hasWild(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "~") {
      i += 1;
      continue;
    }
    if (c === "*" || c === "?") return true;
  }
  return false;
}

function wildRegExp(pat: string): RegExp {
  let src = "^";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i] ?? "";
    if (c === "~") {
      const n = pat[i + 1];
      if (n === "*" || n === "?" || n === "~") {
        src += escapeReg(n);
        i += 1;
        continue;
      }
    }
    if (c === "*") src += "[\\s\\S]*";
    else if (c === "?") src += "[\\s\\S]";
    else src += escapeReg(c);
  }
  return new RegExp(`${src}$`, "i");
}

function escapeReg(c: string): string {
  if ("\\^$+?.()|[]{}".includes(c)) return `\\${c}`;
  return c;
}

function near(a: number, b: number): boolean {
  if (a === b) return true;
  const diff = a > b ? a - b : b - a;
  const scaleA = a < 0 ? -a : a;
  const scaleB = b < 0 ? -b : b;
  return diff < scaleA * EPS || diff < scaleB * EPS;
}
