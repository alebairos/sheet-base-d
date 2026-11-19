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

type NumOrErr = { kind: "number"; n: number } | { kind: "error"; code: ErrorCode };

const FNS: { readonly [name: string]: Fn } = {
  SUM: sum,
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
