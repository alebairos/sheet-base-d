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
    book: { sheets: { Sheet1: { A1: '=B1=""' } } },
    cell: "Sheet1!A1",
    expect: true,
    note: "SPEC blank as empty text; Calc blank=\"\" is TRUE",
  },
  {
    id: "blank-ne-empty",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '=B1<>""' } } },
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
    note: "CLI --cell missing sheet; README #REF!",
  },
  {
    id: "cmp-case",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: '="A"="a"' } } },
    cell: "Sheet1!A1",
    expect: false,
    note: "Calc comparison operators are case-sensitive (IgnoreCase false)",
  },
  {
    id: "match-a-star",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "apple", A2: "apricot", B1: '=MATCH("a*",A1:A2,0)' } } },
    cell: "Sheet1!B1",
    expect: { error: "#N/A" },
    note: "Calc default FormulaSearchType is regex; a* does not match apple",
  },
  {
    id: "vlookup-a-star",
    pri: "P0",
    book: {
      sheets: {
        Sheet1: { A1: "apple", B1: 10, A2: "apricot", B2: 20, C1: '=VLOOKUP("a*",A1:B2,2,FALSE)' },
      },
    },
    cell: "Sheet1!C1",
    expect: { error: "#N/A" },
    note: "Calc regex criteria; a* is not Excel-style wildcard",
  },
  {
    id: "countif-a-star",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "apple", A2: "apricot", B1: '=COUNTIF(A1:A2,"a*")' } } },
    cell: "Sheet1!B1",
    expect: 0,
    note: "Calc regex a* does not match apple (a.* does)",
  },
  {
    id: "countif-a-dotstar",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "apple", A2: "apricot", B1: '=COUNTIF(A1:A2,"a.*")' } } },
    cell: "Sheet1!B1",
    expect: 2,
    note: "Calc regex full-match a.* matches apple and apricot",
  },
  {
    id: "sumif-a-star",
    pri: "P0",
    book: {
      sheets: {
        Sheet1: { A1: "ax", B1: 1, A2: "by", B2: 2, C1: '=SUMIF(A1:A2,"a*",B1:B2)' },
      },
    },
    cell: "Sheet1!C1",
    expect: 0,
    note: "Calc regex SUMIF a* sums nothing for ax/by",
  },
  {
    id: "left-neg",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '=LEFT("ab",-1)' } } },
    cell: "Sheet1!A1",
    expect: { error: "#NUM!" },
    note: "Calc Err:502 for negative LEFT count",
  },
  {
    id: "mid-start0",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '=MID("ab",0,1)' } } },
    cell: "Sheet1!A1",
    expect: { error: "#NUM!" },
    note: "Calc Err:502 for MID start < 1",
  },
  {
    id: "wild-crash",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "ab", B1: '=MATCH("*~*",A1,0)' } } },
    cell: "Sheet1!B1",
    expect: { error: "#N/A" },
    note: "escaped/trailing tilde must not throw Invalid regular expression",
  },
  {
    id: "wild-escape",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "a*b", B1: '=MATCH("a~*b",A1,0)' } } },
    cell: "Sheet1!B1",
    expect: { error: "#N/A" },
    note: "a~*b is a regex, so it does not match a*b",
  },
  {
    id: "crit-wild-num",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 123, A2: "x", B1: '=COUNTIF(A1:A2,"*")' } } },
    cell: "Sheet1!B1",
    expect: 0,
    note: "invalid regex * is literal and matches neither 123 nor x",
  },
  {
    id: "wild-emoji-q",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "a😀b", B1: '=MATCH("a?b",A1,0)' } } },
    cell: "Sheet1!B1",
    expect: { error: "#N/A" },
    note: "regex a?b is optional a then b, so it misses a😀b",
  },
  {
    id: "vlookup-col0",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 1, B1: 10, C1: "=VLOOKUP(1,A1:B1,0,FALSE)" } } },
    cell: "Sheet1!C1",
    expect: { error: "#NUM!" },
    note: "Calc Err:502 for VLOOKUP column index < 1",
  },
  {
    id: "index-neg",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 1, A2: 2, B1: "=INDEX(A1:A2,-1)" } } },
    cell: "Sheet1!B1",
    expect: { error: "#NUM!" },
    note: "Calc Err:502 for negative INDEX",
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
    console.log(
      `FAIL ${c.pri} ${c.id}: got=${JSON.stringify(got)} expect=${JSON.stringify(c.expect)} (${c.note})`,
    );
  }
}

console.log(`GAPS ${fail}`);
console.log(`CASES ${cases.length}`);
process.exit(fail === 0 ? 0 : 1);
