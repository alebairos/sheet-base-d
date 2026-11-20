import { asNumber, asText } from "./eval.js";
import type { Fn, FnHost } from "./fn.js";
import type { Expr } from "./parse.js";
import type { ErrorCode, Value } from "./value.js";

type TextOrErr = { kind: "text"; t: string } | { kind: "error"; code: ErrorCode };
type CountOrErr = { kind: "count"; n: number } | { kind: "error"; code: ErrorCode };

export const textFns = {
  CONCATENATE: concatenate,
  LEFT: left,
  RIGHT: right,
  MID: mid,
  LEN: len,
  UPPER: (args, host) => mapText(args, host, upperText),
  LOWER: (args, host) => mapText(args, host, lowerText),
  TRIM: (args, host) => mapText(args, host, trimSpaces),
} satisfies { readonly [name: string]: Fn };

function concatenate(args: readonly Expr[], host: FnHost): Value {
  let out = "";
  for (const expr of args) {
    const text = textOf(expr, host);
    if (text.kind === "error") return text;
    out += text.t;
  }
  return { kind: "text", t: out };
}

function left(args: readonly Expr[], host: FnHost): Value {
  if (args.length < 1 || args.length > 2) return { kind: "error", code: "#VALUE!" };
  const textExpr = args[0];
  if (textExpr === undefined) return { kind: "error", code: "#VALUE!" };
  const text = textOf(textExpr, host);
  if (text.kind === "error") return text;
  const count: CountOrErr = args.length === 1 ? { kind: "count", n: 1 } : countOf(args[1], host);
  if (count.kind === "error") return count;
  return { kind: "text", t: slicePoints(text.t, 0, count.n) };
}

function right(args: readonly Expr[], host: FnHost): Value {
  if (args.length < 1 || args.length > 2) return { kind: "error", code: "#VALUE!" };
  const textExpr = args[0];
  if (textExpr === undefined) return { kind: "error", code: "#VALUE!" };
  const text = textOf(textExpr, host);
  if (text.kind === "error") return text;
  const count: CountOrErr = args.length === 1 ? { kind: "count", n: 1 } : countOf(args[1], host);
  if (count.kind === "error") return count;
  const points = Array.from(text.t);
  const start = points.length > count.n ? points.length - count.n : 0;
  return { kind: "text", t: points.slice(start).join("") };
}

function mid(args: readonly Expr[], host: FnHost): Value {
  if (args.length !== 3) return { kind: "error", code: "#VALUE!" };
  const textExpr = args[0];
  if (textExpr === undefined) return { kind: "error", code: "#VALUE!" };
  const text = textOf(textExpr, host);
  if (text.kind === "error") return text;
  const start = countOf(args[1], host);
  if (start.kind === "error") return start;
  if (start.n < 1) return { kind: "error", code: "#NUM!" };
  const count = countOf(args[2], host);
  if (count.kind === "error") return count;
  return { kind: "text", t: slicePoints(text.t, start.n - 1, count.n) };
}

function len(args: readonly Expr[], host: FnHost): Value {
  const text = oneText(args, host);
  if (text.kind === "error") return text;
  return host.number(Array.from(text.t).length);
}

// JS toUpperCase expands ß to SS. Calc maps it to ẞ.
const CALC_UPPER: Readonly<Record<string, string>> = { "\u00DF": "\u1E9E" };

// JS toLowerCase expands İ to i + U+0307. Calc leaves it.
const CALC_LOWER: Readonly<Record<string, string>> = { "\u0130": "\u0130" };

function upperText(text: string): string {
  return mapCase(text, (part) => part.toUpperCase(), CALC_UPPER);
}

function lowerText(text: string): string {
  return mapCase(text, (part) => part.toLowerCase(), CALC_LOWER);
}

function mapCase(
  text: string,
  convert: (part: string) => string,
  points: Readonly<Record<string, string>>,
): string {
  let out = "";
  let run = "";
  for (const ch of text) {
    const mapped = points[ch];
    if (mapped === undefined) {
      run += ch;
      continue;
    }
    if (run !== "") {
      out += convert(run);
      run = "";
    }
    out += mapped;
  }
  if (run !== "") out += convert(run);
  return out;
}

function mapText(args: readonly Expr[], host: FnHost, fn: (text: string) => string): Value {
  const text = oneText(args, host);
  if (text.kind === "error") return text;
  return { kind: "text", t: fn(text.t) };
}

function oneText(args: readonly Expr[], host: FnHost): TextOrErr {
  if (args.length !== 1) return { kind: "error", code: "#VALUE!" };
  return textOf(args[0], host);
}

function textOf(expr: Expr | undefined, host: FnHost): TextOrErr {
  if (expr === undefined) return { kind: "error", code: "#VALUE!" };
  const value = host.scalar(expr);
  if (value.kind === "error") return value;
  return asText(value);
}

function countOf(expr: Expr | undefined, host: FnHost): CountOrErr {
  if (expr === undefined) return { kind: "error", code: "#VALUE!" };
  const value = host.scalar(expr);
  if (value.kind === "error") return value;
  const n = asNumber(value);
  if (n.kind === "error") return n;
  if (n.n < 0) return { kind: "error", code: "#NUM!" };
  return { kind: "count", n: Math.trunc(n.n) };
}

function slicePoints(text: string, start: number, count: number): string {
  if (count <= 0) return "";
  return Array.from(text).slice(start, start + count).join("");
}

function trimSpaces(text: string): string {
  let i = 0;
  while (i < text.length && text[i] === " ") i++;
  let end = text.length;
  while (end > i && text[end - 1] === " ") end--;
  let out = "";
  let gap = false;
  for (let j = i; j < end; j++) {
    const c = text[j];
    if (c === " ") {
      gap = true;
      continue;
    }
    if (gap) out += " ";
    gap = false;
    if (c !== undefined) out += c;
  }
  return out;
}
