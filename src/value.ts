export const ERROR_CODES = [
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#N/A",
  "#NUM!",
  "#NULL!",
  "#CIRC!",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type Value =
  | { kind: "number"; n: number }
  | { kind: "text"; t: string }
  | { kind: "bool"; b: boolean }
  | { kind: "blank" }
  | { kind: "error"; code: ErrorCode };

export type CellJson = number | string | boolean | null | { error: ErrorCode };

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(code: string): code is ErrorCode {
  for (const item of ERROR_CODES) {
    if (item === code) return true;
  }
  return false;
}

export function encodeCell(value: Value): CellJson {
  switch (value.kind) {
    case "number":
      return value.n;
    case "text":
      return value.t;
    case "bool":
      return value.b;
    case "blank":
      return null;
    case "error":
      return { error: value.code };
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

export function decodeCell(json: unknown): Value {
  if (typeof json === "number") {
    if (!Number.isFinite(json)) throw new Error("cell number must be finite");
    return { kind: "number", n: json };
  }
  if (typeof json === "string") return { kind: "text", t: json };
  if (typeof json === "boolean") return { kind: "bool", b: json };
  if (json === null) return { kind: "blank" };
  if (isJsonObject(json)) {
    const keys = Object.keys(json);
    const code = json.error;
    if (
      keys.length === 1 &&
      keys[0] === "error" &&
      typeof code === "string" &&
      isErrorCode(code)
    ) {
      return { kind: "error", code };
    }
  }
  throw new Error("bad cell");
}
