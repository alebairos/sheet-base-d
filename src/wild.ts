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
      return value.n === 0 ? "0" : String(value.n);
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
  const caseOff = pattern.includes("(?-i)");
  const body = pattern.replaceAll("(?-i)", "").replaceAll("(?i)", "");
  try {
    return new RegExp(`^(?:${body})$`, caseOff ? "u" : "iu").test(text);
  } catch {
    return foldCriteria(text) === foldCriteria(pattern);
  }
}
