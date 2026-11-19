import { asNumber } from "./eval.js";
import type { Fn, FnHost } from "./fn.js";
import type { Expr } from "./parse.js";
import type { ErrorCode, Value } from "./value.js";

type Bits = { kind: "bits"; values: boolean[] } | { kind: "error"; code: ErrorCode };
type BoolOrErr = { kind: "bool"; b: boolean } | { kind: "error"; code: ErrorCode };

export const logicFns = {
  IF: ifFn,
  IFERROR: ifError,
  AND: (args, host) => foldLogic(args, host, "and"),
  OR: (args, host) => foldLogic(args, host, "or"),
  NOT: notFn,
  ISBLANK: (args, host) => classify(args, host, (value) => value.kind === "blank"),
  ISNUMBER: (args, host) => classify(args, host, (value) => value.kind === "number" || value.kind === "bool"),
  ISTEXT: (args, host) => classify(args, host, (value) => value.kind === "text"),
  ISERROR: (args, host) => classify(args, host, (value) => value.kind === "error"),
} satisfies { readonly [name: string]: Fn };

function ifFn(args: readonly Expr[], host: FnHost): Value {
  if (args.length < 1 || args.length > 3) return { kind: "error", code: "#VALUE!" };
  const condExpr = args[0];
  if (condExpr === undefined) return { kind: "error", code: "#VALUE!" };
  const cond = logical(condExpr, host);
  if (cond.kind === "error") return cond;
  if (args.length === 1) return { kind: "bool", b: cond.b };
  if (cond.b) return branch(args[1], host);
  if (args.length === 2) return { kind: "bool", b: false };
  return branch(args[2], host);
}

function branch(expr: Expr | undefined, host: FnHost): Value {
  if (expr === undefined) return { kind: "error", code: "#VALUE!" };
  return host.scalar(expr);
}

function ifError(args: readonly Expr[], host: FnHost): Value {
  if (args.length !== 2) return { kind: "error", code: "#VALUE!" };
  const valueExpr = args[0];
  const fallback = args[1];
  if (valueExpr === undefined || fallback === undefined) return { kind: "error", code: "#VALUE!" };
  const value = host.scalar(valueExpr);
  if (value.kind === "error") return host.scalar(fallback);
  return value;
}

function notFn(args: readonly Expr[], host: FnHost): Value {
  if (args.length !== 1) return { kind: "error", code: "#VALUE!" };
  const expr = args[0];
  if (expr === undefined) return { kind: "error", code: "#VALUE!" };
  const cond = logical(expr, host);
  if (cond.kind === "error") return cond;
  return { kind: "bool", b: !cond.b };
}

function logical(expr: Expr, host: FnHost): BoolOrErr {
  const value = host.scalar(expr);
  if (value.kind === "error") return value;
  const n = asNumber(value);
  if (n.kind === "error") return n;
  return { kind: "bool", b: n.n !== 0 };
}

function classify(args: readonly Expr[], host: FnHost, pred: (value: Value) => boolean): Value {
  if (args.length !== 1) return { kind: "error", code: "#VALUE!" };
  const expr = args[0];
  if (expr === undefined) return { kind: "error", code: "#VALUE!" };
  return { kind: "bool", b: pred(host.scalar(expr)) };
}

function foldLogic(args: readonly Expr[], host: FnHost, mode: "and" | "or"): Value {
  if (args.length === 0) return { kind: "error", code: "#VALUE!" };
  let saw = false;
  let anyTrue = false;
  let anyFalse = false;
  for (const expr of args) {
    const part = logicArg(expr, host);
    if (part.kind === "error") return part;
    for (const bit of part.values) {
      saw = true;
      if (bit) anyTrue = true;
      else anyFalse = true;
    }
  }
  if (!saw) return { kind: "error", code: "#VALUE!" };
  return { kind: "bool", b: mode === "and" ? !anyFalse : anyTrue };
}

function logicArg(expr: Expr, host: FnHost): Bits {
  const arg = host.arg(expr);
  if (arg.kind === "value") return logicValue(arg.value);
  const values: boolean[] = [];
  for (let row = arg.row0; row <= arg.row1; row++) {
    for (let col = arg.col0; col <= arg.col1; col++) {
      const cell = host.cell(arg.sheet, col, row);
      if (cell.kind === "error") return cell;
      const bit = logicCell(cell);
      if (bit === "skip") continue;
      values.push(bit);
    }
  }
  return { kind: "bits", values };
}

function logicCell(value: Exclude<Value, { kind: "error" }>): boolean | "skip" {
  switch (value.kind) {
    case "blank":
    case "text":
      return "skip";
    case "number":
      return value.n !== 0;
    case "bool":
      return value.b;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function logicValue(value: Value): Bits {
  switch (value.kind) {
    case "error":
      return value;
    case "blank":
      return { kind: "bits", values: [false] };
    case "bool":
      return { kind: "bits", values: [value.b] };
    case "number":
      return { kind: "bits", values: [value.n !== 0] };
    case "text":
      return { kind: "error", code: "#VALUE!" };
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}
