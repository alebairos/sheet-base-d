import { parseA1, type CellAddr } from "./addr.js";
import { decodeCell, encodeCell, isJsonObject, type CellJson, type Value } from "./value.js";

export type InputCell = Value | { kind: "formula"; src: string };

export type Workbook = {
  sheets: Record<string, Record<string, InputCell>>;
};

export type ComputedWorkbook = {
  sheets: Record<string, Record<string, Value>>;
};

export type WorkbookJson = {
  sheets: Record<string, Record<string, Exclude<CellJson, null>>>;
};

function parseInputCell(json: unknown): InputCell {
  if (typeof json === "string" && json.startsWith("=")) {
    return { kind: "formula", src: json };
  }
  return decodeCell(json);
}

export function parseWorkbook(raw: unknown): Workbook {
  if (!isJsonObject(raw) || !isJsonObject(raw.sheets)) {
    throw new Error("workbook must be { sheets: { ... } }");
  }
  const sheets: Workbook["sheets"] = {};
  for (const [name, sheet] of Object.entries(raw.sheets)) {
    if (!isJsonObject(sheet)) throw new Error(`sheet ${name} must be an object`);
    const cells: Record<string, InputCell> = {};
    for (const [key, cell] of Object.entries(sheet)) {
      cells[key] = parseInputCell(cell);
    }
    sheets[name] = cells;
  }
  return { sheets };
}

function evalCell(cell: InputCell): Value {
  switch (cell.kind) {
    case "formula":
      return { kind: "error", code: "#NAME?" };
    case "number":
    case "text":
    case "bool":
    case "blank":
    case "error":
      return cell;
    default: {
      const exhaustive: never = cell;
      return exhaustive;
    }
  }
}

export function computeWorkbook(wb: Workbook): ComputedWorkbook {
  const sheets: ComputedWorkbook["sheets"] = {};
  for (const [name, cells] of Object.entries(wb.sheets)) {
    const out: Record<string, Value> = {};
    for (const [key, cell] of Object.entries(cells)) {
      const value = evalCell(cell);
      if (value.kind !== "blank") out[key] = value;
    }
    sheets[name] = out;
  }
  return { sheets };
}

export function encodeWorkbook(computed: ComputedWorkbook): WorkbookJson {
  const sheets: WorkbookJson["sheets"] = {};
  for (const [name, cells] of Object.entries(computed.sheets)) {
    const out: WorkbookJson["sheets"][string] = {};
    for (const [key, value] of Object.entries(cells)) {
      const encoded = encodeCell(value);
      if (encoded !== null) out[key] = encoded;
    }
    sheets[name] = out;
  }
  return { sheets };
}

export function lookupCell(wb: Workbook, ref: { sheet: string; addr: CellAddr }): Value {
  const cells = wb.sheets[ref.sheet];
  if (cells === undefined) return { kind: "error", code: "#REF!" };
  for (const [key, cell] of Object.entries(cells)) {
    const addr = parseA1(key);
    if (addr !== null && addr.col === ref.addr.col && addr.row === ref.addr.row) {
      return evalCell(cell);
    }
  }
  return { kind: "blank" };
}
