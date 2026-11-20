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

// JS toUpperCase expands ß to SS. Equality criteria leave ß unchanged, so ß does not match ss.
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
  const found = compiled.exec(text);
  // Calc keeps the first match. It counts only when that match covers the whole text.
  return found !== null && found.index === 0 && found[0].length === text.length;
}

type Mode = { i: boolean; s: boolean; m: boolean; x: boolean };
type Scan = { src: string; i: number; sawFlag: boolean };

const FREE_SPACE = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);

// Calc criteria use ICU flags. Each flag changes the mode from that point.
// (?x) drops free-spacing whitespace and # comments, including inside classes.
// A flag written inside a character class stays a literal character.
function compileCriteria(pattern: string): RegExp | "never" | "literal" {
  // Calc keeps a one-character ^ $ or | as that character. A longer pattern still anchors or alternates.
  if (pattern === "^" || pattern === "$" || pattern === "|") return "literal";
  const rewritten = rewritePosix(pattern);
  if (rewritten === "never") return "never";
  const scan: Scan = { src: rewritten, i: 0, sawFlag: false };
  const mode: Mode = { i: true, s: false, m: false, x: false };
  const body = readSeq(scan, false, mode);
  if (body === null) return "never";
  try {
    // No outer ^(?:...)$. That anchor retries a later alternative or a longer lazy match. Calc does not.
    return new RegExp(body, "u");
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
    const escaped = takeEscape(scan, mode, false);
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
      buf += readClass(scan, mode);
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
    buf += sharpFold(c, mode.i) ?? c;
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
    const escaped = takeEscape(scan, mode, true);
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
    if (c === "]" && primed && !afterCaret) return finishClass(body);
    body += c;
    if (c === "^" && !primed) {
      primed = true;
      afterCaret = true;
      continue;
    }
    primed = true;
    afterCaret = false;
  }
  return `[${body.split(WORD_COMP).join("\\W")}`;
}

// Calc \d and \w use Unicode properties. A pure \W class is the complement of that set.
// A class that also lists other characters keeps ASCII \W. JS u-mode cannot spell that union.
const WORD_PROPS = "\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}";
const WORD_COMP = "\uE000";

// Calc criteria spell POSIX names as Unicode sets. A name it does not know matches nothing.
// `add` is the set inside an open class. `drop` is [:^name:] when one property can say it.
// `bare` is the same set when the name is not already inside brackets.
type PosixSpell = { add: string | null; drop: string | null; bare: string; bareNeg: string };

const POSIX: Readonly<Record<string, PosixSpell>> = {
  alpha: prop("\\p{Alphabetic}", "\\P{Alphabetic}"),
  upper: prop("\\p{Lu}", "\\P{Lu}"),
  lower: prop("\\p{Ll}", "\\P{Ll}"),
  digit: prop("\\p{Nd}", "\\P{Nd}"),
  xdigit: prop("\\p{AHex}", "\\P{AHex}"),
  alnum: props("\\p{Alphabetic}\\p{Nd}"),
  word: props(WORD_PROPS),
  space: prop("\\p{White_Space}", "\\P{White_Space}"),
  blank: props("\\t\\p{Zs}"),
  punct: prop("\\p{P}", "\\P{P}"),
  cntrl: prop("\\p{Cc}", "\\P{Cc}"),
  ascii: prop("\\p{ASCII}", "\\P{ASCII}"),
  graph: { add: null, drop: null, bare: "[^\\p{Z}\\p{C}]", bareNeg: "[\\p{Z}\\p{C}]" },
  print: {
    add: null,
    drop: null,
    bare: "[^\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Cn}\\p{Zl}\\p{Zp}]",
    bareNeg: "[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Cn}\\p{Zl}\\p{Zp}]",
  },
};

function prop(add: string, drop: string): PosixSpell {
  return { add, drop, bare: `[${add}]`, bareNeg: `[${drop}]` };
}

function props(add: string): PosixSpell {
  return { add, drop: null, bare: `[${add}]`, bareNeg: `[^${add}]` };
}

function rewritePosix(pattern: string): string | "never" {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "\\" && i + 1 < pattern.length) {
      // A quote is literal, including any [:name:] it happens to contain.
      if (pattern[i + 1] === "Q") {
        const stop = quoteStop(pattern, i + 2);
        out += pattern.slice(i, stop);
        i = stop;
        continue;
      }
      out += pattern.slice(i, i + 2);
      i += 2;
      continue;
    }
    const matched = /^\[:(\^)?([A-Za-z]+):\]/.exec(pattern.slice(i));
    if (matched === null) {
      out += pattern[i] ?? "";
      i += 1;
      continue;
    }
    const spec = POSIX[(matched[2] ?? "").toLowerCase()];
    if (spec === undefined) return "never";
    const neg = matched[1] === "^";
    const len = matched[0].length;
    const open = classOpen(out);
    if (!neg && spec.add !== null) {
      out += open === "none" ? spec.bare : spec.add;
      i += len;
      continue;
    }
    if (neg && spec.drop !== null) {
      out += open === "none" ? spec.bareNeg : spec.drop;
      i += len;
      continue;
    }
    if (open === "none") {
      out += neg ? spec.bareNeg : spec.bare;
      i += len;
      continue;
    }
    if ((open === "empty" || open === "caret") && pattern[i + len] === "]") {
      out = open === "caret" ? out.slice(0, -2) : out.slice(0, -1);
      const useNeg = neg !== (open === "caret");
      out += useNeg ? spec.bareNeg : spec.bare;
      i += len + 1;
      continue;
    }
    out += pattern.slice(i, i + len);
    i += len;
  }
  return out;
}

function classOpen(out: string): "none" | "in" | "empty" | "caret" {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === "\\") {
      if (out[i + 1] === "Q") {
        i = quoteStop(out, i + 2) - 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (out[i] === "[") {
      depth += 1;
      start = i;
      continue;
    }
    if (out[i] === "]" && depth > 0) {
      depth -= 1;
      start = -1;
    }
  }
  if (depth === 0 || start < 0) return "none";
  const content = out.slice(start + 1);
  if (content === "") return "empty";
  if (content === "^") return "caret";
  return "in";
}

function finishClass(body: string): string {
  const negated = body.startsWith("^");
  const core = negated ? body.slice(1) : body;
  const parts = core.split(WORD_COMP);
  const rest = parts.join("");
  if (parts.length === 1) return `${negated ? "[^" : "["}${core}]`;
  if (rest === "") return negated ? `[${WORD_PROPS}]` : `[^${WORD_PROPS}]`;
  return `${negated ? "[^" : "["}${rest}\\W]`;
}

function takeEscape(scan: Scan, mode: Mode, inClass: boolean): string | null {
  if (scan.src[scan.i] !== "\\") return null;
  const next = scan.src[scan.i + 1];
  if (next === undefined) {
    scan.i++;
    return "\\";
  }
  if (next === "Q") return quoteLiteral(scan, mode, inClass);
  if (next === "E") {
    scan.i += 2;
    return "E";
  }
  scan.i += 2;
  // Unicode regex rejects an escaped space. In (?x) that escape is a literal space or hash.
  if (mode.x && (FREE_SPACE.has(next) || next === "#")) return next;
  return unicodeClassEscape(next, inClass);
}

// \Q starts a literal run and \E ends it. A missing \E runs through the end of the pattern.
// The run keeps the case mode already in effect. \E with no open quote is the letter E.
function quoteLiteral(scan: Scan, mode: Mode, inClass: boolean): string {
  scan.i += 2;
  let out = "";
  while (scan.i < scan.src.length) {
    const ch = scan.src[scan.i] ?? "";
    if (ch === "\\" && scan.src[scan.i + 1] === "E") {
      scan.i += 2;
      break;
    }
    const folded = inClass ? null : sharpFold(ch, mode.i);
    out += folded ?? escapeLiteral(ch, inClass);
    scan.i += 1;
  }
  return out;
}

// ICU full-folds ß and ẞ to ss. One pattern atom matches either letter or two case-folded s characters.
// A following quantifier binds to that atom. A pattern of SS does not match ß, and a class stays one code point.
const SHARP_FOLD = "(?:[ßẞ]|[sS][sS])";

function sharpFold(ch: string, folding: boolean): string | null {
  if (folding && (ch === "ß" || ch === "ẞ")) return SHARP_FOLD;
  return null;
}

function quoteStop(src: string, from: number): number {
  const end = src.indexOf("\\E", from);
  return end < 0 ? src.length : end + 2;
}

function escapeLiteral(ch: string, inClass: boolean): string {
  if (inClass) return "\\][-^".includes(ch) ? `\\${ch}` : ch;
  return META.test(ch) ? `\\${ch}` : ch;
}

function unicodeClassEscape(next: string, inClass: boolean): string {
  if (next === "d") return "\\p{Nd}";
  if (next === "D") return "\\P{Nd}";
  if (next === "w") return inClass ? WORD_PROPS : `[${WORD_PROPS}]`;
  if (next === "W") return inClass ? WORD_COMP : `[^${WORD_PROPS}]`;
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
