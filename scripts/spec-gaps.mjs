#!/usr/bin/env node
// Frozen hillclimb harness: count open P0/P1 SPEC/Calc gaps.
// Each case is a workbook JSON plus a cell and the Calc-agreed expected JSON value.
// Metric: number of failing cases (lower is better). Prints FAIL count and CASE count.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = path.join(root, "engine");

/** @type {{ id: string; pri: "P0" | "P1"; book: object; cell: string; expect: unknown; note: string }[]} */
const cases = [
  {
    id: "blank-eq-empty",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "=B1=\"\"" } } },
    cell: "Sheet1!A1",
    expect: true,
    note: "SPEC blank as \"\"; Calc blank=\"\" is TRUE",
  },
  {
    id: "blank-ne-empty",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "=B1<>\"\"" } } },
    cell: "Sheet1!A1",
    expect: false,
    note: "blank<>\"\" is FALSE in Calc",
  },
  {
    id: "blank-eq-zero",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "=B1=0" } } },
    cell: "Sheet1!A1",
    expect: true,
    note: "blank as 0 in numeric compare",
  },
  {
    id: "sqrt-neg",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "=SQRT(-1)" } } },
    cell: "Sheet1!A1",
    expect: { error: "#NUM!" },
    note: "Calc Err:502 / Excel #NUM!; POWER already uses #NUM!",
  },
  {
    id: "pow-nest",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "=2^3^2" } } },
    cell: "Sheet1!A1",
    expect: 64,
    note: "Calc left-assoc exponentiation",
  },
  {
    id: "sum-text-lit",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: '=SUM("x")' } } },
    cell: "Sheet1!A1",
    expect: { error: "#VALUE!" },
    note: "SUM text literal rejects",
  },
  {
    id: "circ",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "=A1" } } },
    cell: "Sheet1!A1",
    expect: { error: "#CIRC!" },
    note: "circular ref errors, does not hang",
  },
  {
    id: "missing-sheet-cell",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 1 } } },
    cell: "Missing!A1",
    expect: { error: "#REF!" },
    note: "CLI --cell missing sheet; README #REF! (Calc shows #NAME?)",
  },
];

function runCase(c) {
  const res = spawnSync(engine, ["-", "--cell", c.cell], {
    input: JSON.stringify(c.book),
    encoding: "utf8",
    cwd: root,
  });
  if (res.status !== 0 && res.stdout.trim() === "") {
    return { ok: false, got: `exit ${res.status}: ${res.stderr.trim()}` };
  }
  let got;
  try {
    got = JSON.parse(res.stdout.trim());
  } catch {
    return { ok: false, got: res.stdout.trim() };
  }
  return { ok: JSON.stringify(got) === JSON.stringify(c.expect), got };
}

let fail = 0;
for (const c of cases) {
  const { ok, got } = runCase(c);
  if (!ok) {
    fail += 1;
    console.log(`FAIL ${c.pri} ${c.id}: got=${JSON.stringify(got)} expect=${JSON.stringify(c.expect)} (${c.note})`);
  }
}

console.log(`GAPS ${fail}`);
console.log(`CASES ${cases.length}`);
process.exit(fail === 0 ? 0 : 1);
