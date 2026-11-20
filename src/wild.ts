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

export function criteriaMatch(pattern: string, text: string): boolean {
  if (!isCriteriaRegex(pattern)) return text.toUpperCase() === pattern.toUpperCase();
  try {
    return new RegExp(`^(?:${pattern.replaceAll("(?i)", "")})$`, "iu").test(text);
  } catch {
    return text.toUpperCase() === pattern.toUpperCase();
  }
}
