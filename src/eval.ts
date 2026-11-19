import type { BinOp, Expr } from "./parse.js";
import type { ErrorCode, Value } from "./value.js";

type Num = { kind: "number"; n: number };
type Err = { kind: "error"; code: ErrorCode };
type NumOrErr = Num | Err;

const EPS = 1 / (16777216 * 16777216);

export function evalExpr(expr: Expr): Value {
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
      return evalUnary(expr.op, evalExpr(expr.arg));
    case "binary":
      return evalBinary(expr.op, evalExpr(expr.left), evalExpr(expr.right));
    case "call":
      return { kind: "error", code: "#NAME?" };
    case "ref":
    case "range":
      return { kind: "error", code: "#REF!" };
    default: {
      const exhaustive: never = expr;
      return exhaustive;
    }
  }
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

function raise(base: number, exp: number): number {
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
  if (left.kind === "text" && right.kind === "text") {
    const a = left.t.toUpperCase();
    const b = right.t.toUpperCase();
    if (a < b) return { kind: "number", n: -1 };
    if (a > b) return { kind: "number", n: 1 };
    return { kind: "number", n: 0 };
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

function asNumber(value: Value): NumOrErr {
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

function asText(value: Value): { kind: "text"; t: string } | Err {
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
