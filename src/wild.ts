import { formatNumber } from "./numfmt.js";
import type { Value } from "./value.js";

const META = /[\][.*+?^${}()|\\]/;

export function isCriteriaRegex(pattern: string): boolean {
  return META.test(pattern);
}

export function criteriaText(value: Value): string | null {
  switch (value.kind) {
    case "text":
      return value.t;
    case "number":
      return formatNumber(value.n);
    case "bool":
      return value.b ? "1" : "0";
    default:
      return null;
  }
}

// JS toUpperCase expands ß to SS. Criteria leave ß unchanged, so it does not match ss.
export function foldCriteria(text: string): string {
  let out = "";
  for (const ch of text) out += ch === "ß" ? ch : ch.toUpperCase();
  return out;
}

export function criteriaMatch(pattern: string, text: string): boolean {
  if (!isCriteriaRegex(pattern)) return foldCriteria(text) === foldCriteria(pattern);
  const compiled = compileCriteria(pattern);
  if (compiled === "never") return false;
  if (compiled === "literal") return foldCriteria(text) === foldCriteria(pattern);
  return compiled.test(text);
}

type Mode = { i: boolean; s: boolean; m: boolean; x: boolean };
type Scan = { src: string; i: number; sawFlag: boolean };

const FREE_SPACE = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);

// Calc criteria use ICU flags. Each flag changes the mode from that point.
// (?x) drops free-spacing whitespace and # comments, including inside classes.
// A flag written inside a character class stays a literal character.
function compileCriteria(pattern: string): RegExp | "never" | "literal" {
  const scan: Scan = { src: pattern, i: 0, sawFlag: false };
  const mode: Mode = { i: true, s: false, m: false, x: false };
  const body = readSeq(scan, false, mode);
  if (body === null) return "never";
  try {
    return new RegExp(`^(?:${body})$`, "u");
  } catch (err) {
    // A one-character broken pattern stays a literal, so * matches *.
    // A longer dangling * + ? or an unclosed group or class matches nothing.
    if (pattern.length !== 1 && danglingPattern(err, pattern)) return "never";
    return scan.sawFlag ? "never" : "literal";
  }
}

function danglingPattern(err: unknown, pattern: string): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message;
  if (message.includes("Unterminated group") || message.includes("Unterminated character class")) return true;
  return message.includes("Nothing to repeat") && /[*+?]/.test(pattern);
}

function readSeq(scan: Scan, stop: boolean, mode: Mode): string | null {
  let out = "";
  let buf = "";
  let depth = 0;
  const flush = () => {
    out += wrap(mode, buf);
    buf = "";
  };
  while (scan.i < scan.src.length) {
    const escaped = takeEscape(scan, mode);
    if (escaped !== null) {
      buf += escaped;
      continue;
    }
    const c = scan.src[scan.i] ?? "";
    if (mode.x && c === "#") {
      skipComment(scan);
      continue;
    }
    if (mode.x && FREE_SPACE.has(c)) {
      scan.i++;
      continue;
    }
    if (c === "[") {
      scan.i++;
      buf += c + readClass(scan, mode);
      continue;
    }
    if (c === "(" && scan.src[scan.i + 1] === "?") {
      const group = consumeGroup(scan, mode, flush, (text) => {
        out += text;
      });
      if (group === "never") return null;
      if (group === "handled") continue;
      flush();
      out += group;
      depth++;
      continue;
    }
    if (c === "(" || c === ")" || c === "|") {
      if (c === ")" && stop && depth === 0) {
        flush();
        scan.i++;
        return out;
      }
      flush();
      out += c;
      scan.i++;
      if (c === "(") depth++;
      else if (c === ")" && depth > 0) depth--;
      continue;
    }
    buf += c;
    scan.i++;
  }
  if (stop) return null;
  flush();
  return out;
}

function consumeGroup(
  scan: Scan,
  mode: Mode,
  flush: () => void,
  emit: (text: string) => void,
): "handled" | "never" | string {
  const src = scan.src;
  const prefix = rawGroupPrefix(src, scan.i);
  if (prefix !== null) {
    scan.i += prefix.length;
    return prefix;
  }
  let j = scan.i + 2;
  let on = "";
  let off = "";
  let phase: "on" | "off" = "on";
  while (j < src.length) {
    const c = src[j] ?? "";
    if (c === "-" && phase === "on") {
      phase = "off";
      j++;
      continue;
    }
    if (c === ")" || c === ":") {
      const next = applyMode(mode, on, off);
      scan.sawFlag = true;
      scan.i = j + 1;
      flush();
      if (c === ")") {
        assignMode(mode, next);
        return "handled";
      }
      const saved = { ...mode };
      assignMode(mode, next);
      const inner = readSeq(scan, true, mode);
      assignMode(mode, saved);
      if (inner === null) return "never";
      emit(inner);
      return "handled";
    }
    if (!"imsx".includes(c)) return "never";
    if (phase === "on") on += c;
    else off += c;
    j++;
  }
  return "never";
}

function rawGroupPrefix(src: string, i: number): string | null {
  const slice = src.slice(i, i + 4);
  if (slice.startsWith("(?:") || slice.startsWith("(?=") || slice.startsWith("(?!")) return slice.slice(0, 3);
  if (slice.startsWith("(?<=") || slice.startsWith("(?<!")) return slice.slice(0, 4);
  return null;
}

function readClass(scan: Scan, mode: Mode): string {
  let body = "";
  let primed = false;
  let afterCaret = false;
  while (scan.i < scan.src.length) {
    const escaped = takeEscape(scan, mode);
    if (escaped !== null) {
      body += escaped;
      primed = true;
      afterCaret = false;
      continue;
    }
    const c = scan.src[scan.i] ?? "";
    if (mode.x && c === "#") {
      skipComment(scan);
      continue;
    }
    if (mode.x && FREE_SPACE.has(c)) {
      scan.i++;
      continue;
    }
    scan.i++;
    if (c === "]" && primed && !afterCaret) return body + c;
    body += c;
    if (c === "^" && !primed) {
      primed = true;
      afterCaret = true;
      continue;
    }
    primed = true;
    afterCaret = false;
  }
  return body;
}

function takeEscape(scan: Scan, mode: Mode): string | null {
  if (scan.src[scan.i] !== "\\") return null;
  const next = scan.src[scan.i + 1];
  if (next === undefined) {
    scan.i++;
    return "\\";
  }
  scan.i += 2;
  // Unicode regex rejects an escaped space. In (?x) that escape is a literal space or hash.
  if (mode.x && (FREE_SPACE.has(next) || next === "#")) return next;
  return `\\${next}`;
}

function skipComment(scan: Scan): void {
  scan.i++;
  while (scan.i < scan.src.length && scan.src[scan.i] !== "\n") scan.i++;
  if (scan.src[scan.i] === "\n") scan.i++;
}

function wrap(mode: Mode, buf: string): string {
  if (buf === "") return "";
  let on = "";
  if (mode.i) on += "i";
  if (mode.s) on += "s";
  if (mode.m) on += "m";
  if (!mode.i && on === "") return buf;
  if (!mode.i) return `(?${on}-i:${buf})`;
  return `(?${on}:${buf})`;
}

function applyMode(mode: Mode, on: string, off: string): Mode {
  const next = { ...mode };
  const set = (flag: string, value: boolean) => {
    if (flag === "i") next.i = value;
    if (flag === "s") next.s = value;
    if (flag === "m") next.m = value;
    if (flag === "x") next.x = value;
  };
  for (const flag of on) set(flag, true);
  for (const flag of off) set(flag, false);
  return next;
}

function assignMode(mode: Mode, next: Mode): void {
  mode.i = next.i;
  mode.s = next.s;
  mode.m = next.m;
  mode.x = next.x;
}
