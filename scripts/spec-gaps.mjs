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
  {
    id: "min-bool-literals",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "=MIN(TRUE,FALSE)" } } },
    cell: "Sheet1!A1",
    expect: 0,
    note: "Calc MIN of boolean literals returns a number",
  },
  {
    id: "max-bool-literals",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "=MAX(TRUE,FALSE)" } } },
    cell: "Sheet1!A1",
    expect: 1,
    note: "Calc MAX of boolean literals returns a number",
  },
  {
    id: "min-one-bool",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "=MIN(TRUE)" } } },
    cell: "Sheet1!A1",
    expect: 1,
    note: "Calc MIN(TRUE) is the number 1",
  },
  {
    id: "max-false-neg",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "=MAX(FALSE,-1)" } } },
    cell: "Sheet1!A1",
    expect: 0,
    note: "Calc FALSE literal is 0 in MAX",
  },
  {
    id: "min-bool-then-zero",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "=TRUE()", B1: "=MIN(A1,0)" } } },
    cell: "Sheet1!B1",
    expect: false,
    note: "first value boolean cell and result 0/1 keeps boolean type",
  },
  {
    id: "min-num-then-bool",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "=FALSE()", B1: "=MIN(2,A1)" } } },
    cell: "Sheet1!B1",
    expect: 0,
    note: "first value number keeps numeric type",
  },
  {
    id: "max-bool-then-one",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "=FALSE()", B1: "=MAX(A1,1)" } } },
    cell: "Sheet1!B1",
    expect: true,
    note: "first value boolean cell and result 1 keeps boolean type",
  },
  {
    id: "true-extra-arg",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "=TRUE(1)" } } },
    cell: "Sheet1!A1",
    expect: { error: "#VALUE!" },
    note: "Calc Err:508 for TRUE with arguments",
  },
  {
    id: "parse-trailing-op",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "=1+" } } },
    cell: "Sheet1!A1",
    expect: { error: "#N/A" },
    note: "Calc Err:520 exports as #N/A",
  },
  {
    id: "cmp-upper-lt-lower",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: '="A"<"a"' } } },
    cell: "Sheet1!A1",
    expect: false,
    note: "Calc text order case-folds; lowercase before uppercase",
  },
  {
    id: "cmp-lower-lt-upper",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: '="a"<"A"' } } },
    cell: "Sheet1!A1",
    expect: true,
    note: "Calc text order: a before A when case-sensitive",
  },
  {
    id: "cmp-b-lt-a",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: '="B"<"a"' } } },
    cell: "Sheet1!A1",
    expect: false,
    note: "case-fold then letter order; B is not before a",
  },
  {
    id: "vlookup-bool-num",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "=VLOOKUP(20,D1:E1,2,FALSE)", D1: 20, E1: false } } },
    cell: "Sheet1!A1",
    expect: 0,
    note: "Calc VLOOKUP coerces boolean result to number; INDEX keeps bool",
  },
  {
    id: "parse-open-string",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '="abc' } } },
    cell: "Sheet1!A1",
    expect: { error: "#NAME?" },
    note: "Calc unclosed string is #NAME?",
  },
  {
    id: "parse-hash",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "=1#2" } } },
    cell: "Sheet1!A1",
    expect: { error: "#NAME?" },
    note: "Calc bare # token is #NAME?",
  },
  {
    id: "countif-inline-case",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: {
          A1: "Apple",
          A2: "apple",
          A3: "APPLE",
          A4: "banana",
          B1: '=COUNTIF(A1:A4,"(?i)apple")',
        },
      },
    },
    cell: "Sheet1!B1",
    expect: 3,
    note: "Calc regex accepts (?i) inline case fold",
  },
  {
    id: "index-row-intersect",
    pri: "P0",
    book: {
      sheets: {
        Sheet1: {
          A1: 11,
          B1: 12,
          C1: 13,
          A2: 21,
          B2: 22,
          C2: 23,
          A3: 31,
          B3: 32,
          C3: 33,
          B5: "=INDEX(A1:C3,2)",
        },
      },
    },
    cell: "Sheet1!B5",
    expect: 22,
    note: "INDEX row intersects formula column",
  },
  {
    id: "index-col-intersect",
    pri: "P0",
    book: {
      sheets: {
        Sheet1: { A1: 11, A2: 21, A3: 31, B2: "=INDEX(A1:A3,0)" },
      },
    },
    cell: "Sheet1!B2",
    expect: 21,
    note: "INDEX col with row 0 intersects formula row",
  },
  {
    id: "index-row0-intersect",
    pri: "P0",
    book: {
      sheets: {
        Sheet1: { A1: 11, B1: 12, C1: 13, B3: "=INDEX(A1:C1,0)" },
      },
    },
    cell: "Sheet1!B3",
    expect: 12,
    note: "INDEX row with row 0 intersects formula column",
  },
  {
    id: "countif-case-off",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: {
          A1: "Apple",
          A2: "apple",
          A3: "APPLE",
          B1: '=COUNTIF(A1:A3,"(?-i)apple")',
        },
      },
    },
    cell: "Sheet1!B1",
    expect: 1,
    note: "Calc (?-i) turns off case-insensitive regex",
  },
  {
    id: "range-intersect",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: {
          A1: 1,
          B1: 2,
          C1: 3,
          A2: 4,
          B2: 5,
          C2: 6,
          A3: 7,
          B3: 8,
          C3: 9,
          A4: "=A1:C3!B2:B2",
        },
      },
    },
    cell: "Sheet1!A4",
    expect: 5,
    note: "Calc ! between ranges is intersection",
  },
  {
    id: "range-intersect-cell",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: {
          A1: 1,
          B1: 2,
          C1: 3,
          A2: 4,
          B2: 5,
          C2: 6,
          A3: "=A1:C2!B2",
        },
      },
    },
    cell: "Sheet1!A3",
    expect: 5,
    note: "range!cell intersection",
  },
  {
    id: "vlookup-approx-unsorted-hit",
    pri: "P0",
    book: {
      sheets: {
        Sheet1: { A1: 100, B1: 1, A2: 50, B2: 2, A3: 200, B3: 3, C1: "=VLOOKUP(50,A1:B3,2,TRUE)" },
      },
    },
    cell: "Sheet1!C1",
    expect: 2,
    note: "Calc approximate VLOOKUP finds an equal key after a larger value",
  },
  {
    id: "match-approx-unsorted-hit",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: 100, A2: 50, A3: 200, B1: "=MATCH(50,A1:A3,1)" } } },
    cell: "Sheet1!B1",
    expect: 2,
    note: "Calc approximate MATCH finds an equal key after a larger value",
  },
  {
    id: "vlookup-approx-unsorted-miss",
    pri: "P0",
    book: {
      sheets: {
        Sheet1: { A1: 100, B1: 1, A2: 50, B2: 2, A3: 200, B3: 3, C1: "=VLOOKUP(75,A1:B3,2,TRUE)" },
      },
    },
    cell: "Sheet1!C1",
    expect: { error: "#N/A" },
    note: "Calc approximate VLOOKUP of a between-key on unsorted rows is #N/A",
  },
  {
    id: "match-approx-unsorted-miss",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: 100, A2: 50, A3: 200, B1: "=MATCH(75,A1:A3,1)" } } },
    cell: "Sheet1!B1",
    expect: { error: "#N/A" },
    note: "Calc approximate MATCH of a between-key on unsorted rows is #N/A",
  },
  {
    id: "countif-eszett",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "ss", B1: '=COUNTIF(A1,"ß")' } } },
    cell: "Sheet1!B1",
    expect: 0,
    note: "Calc COUNTIF does not treat ß as equal to ss",
  },
  {
    id: "match-eszett",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "ss", B1: '=MATCH("ß",A1,0)' } } },
    cell: "Sheet1!B1",
    expect: { error: "#N/A" },
    note: "Calc MATCH does not treat ß as equal to ss",
  },
  {
    id: "vlookup-eszett",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "ss", B1: 7, C1: '=VLOOKUP("ß",A1:B1,2,FALSE)' } } },
    cell: "Sheet1!C1",
    expect: { error: "#N/A" },
    note: "Calc VLOOKUP does not treat ß as equal to ss",
  },
  {
    id: "intersect-null",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: "=A1:A2!C1:C2" } } },
    cell: "Sheet1!A1",
    expect: { error: "#NULL!" },
    note: "Calc empty range intersection is #NULL!",
  },
  {
    id: "space-intersect",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 10, A2: 20, A3: 30, B1: "=A1:A3 A2" } } },
    cell: "Sheet1!B1",
    expect: 20,
    note: "Calc space between refs is intersection",
  },
  {
    id: "tilde-union",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 4, A2: 6, B1: "=SUM(A1:A1~A2:A2)" } } },
    cell: "Sheet1!B1",
    expect: 10,
    note: "Calc ~ is range union",
  },
  {
    id: "sheet-span",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: { A1: "=SUM(Sheet1!A2:Sheet2!A2)", A2: 4 },
        Sheet2: { A2: 6 },
      },
    },
    cell: "Sheet1!A1",
    expect: 10,
    note: "Calc range with ends on two sheets sums across the sheet span",
  },
  {
    id: "index-union-1",
    pri: "P0",
    book: {
      sheets: {
        Sheet1: { A1: 1, A2: 4, C1: 9, C2: 8, B1: "=INDEX((A1:A2~C1:C2),2,1,1)" },
      },
    },
    cell: "Sheet1!B1",
    expect: 4,
    note: "Calc INDEX area 1 of a union is the first range",
  },
  {
    id: "index-union-2",
    pri: "P0",
    book: {
      sheets: {
        Sheet1: { A1: 1, A2: 4, C1: 9, C2: 8, B1: "=INDEX((A1:A2~C1:C2),1,1,2)" },
      },
    },
    cell: "Sheet1!B1",
    expect: 9,
    note: "Calc INDEX area 2 of a union is the second range",
  },
  {
    id: "match-text-approx",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: "a", A2: "c", A3: "b", B1: '=MATCH("b",A1:A3,1)' } } },
    cell: "Sheet1!B1",
    expect: 1,
    note: "Calc approximate text MATCH stops at first greater key; later equal ignored",
  },
  {
    id: "vlookup-text-approx",
    pri: "P0",
    book: {
      sheets: {
        Sheet1: {
          A1: "a",
          B1: 10,
          A2: "c",
          B2: 20,
          A3: "b",
          B3: 30,
          C1: '=VLOOKUP("b",A1:B3,2,TRUE)',
        },
      },
    },
    cell: "Sheet1!C1",
    expect: 10,
    note: "Calc approximate text VLOOKUP keeps earlier in-order row",
  },
  {
    id: "match-desc-asc",
    pri: "P0",
    book: { sheets: { Sheet1: { A1: 1, A2: 2, A3: 3, B1: "=MATCH(2,A1:A3,-1)" } } },
    cell: "Sheet1!B1",
    expect: { error: "#N/A" },
    note: "Calc descending MATCH on an ascending list is #N/A even with an equal",
  },
  {
    id: "match-desc-break",
    pri: "P0",
    book: { sheets: { Sheet1: { G1: 3, G2: 1, G3: 2, H1: "=MATCH(2,G1:G3,-1)" } } },
    cell: "Sheet1!H1",
    expect: 1,
    note: "Calc descending MATCH keeps the first in-order candidate and ignores a later equal after a break",
  },
  {
    id: "match-blank",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 1, A2: "", A3: "x", B1: "=MATCH(C1,A1:A3,0)" } } },
    cell: "Sheet1!B1",
    expect: 2,
    note: "Calc exact MATCH of a blank key matches an empty string",
  },
  {
    id: "scalar-3d",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: { A1: 3, B1: "=Sheet1!A1:Sheet2!A1" },
        Sheet2: { A1: 4 },
      },
    },
    cell: "Sheet1!B1",
    expect: 3,
    note: "Calc scalar use of a one-cell sheet span returns that cell on the formula sheet",
  },
  {
    id: "upper-eszett",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '=UPPER("ß")' } } },
    cell: "Sheet1!A1",
    expect: "ẞ",
    note: "Calc UPPER(ß) is capital sharp S U+1E9E, not SS",
  },
  {
    id: "lower-i-dot",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '=LOWER("İ")' } } },
    cell: "Sheet1!A1",
    expect: "İ",
    note: "Calc LOWER(İ) leaves U+0130 unchanged",
  },
  {
    id: "xsheet-bang",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: { A1: 1, B2: 5, D1: "=Sheet1!A1:C3!Sheet2!B2" },
        Sheet2: { B2: 50 },
      },
    },
    cell: "Sheet1!D1",
    expect: { error: "#NULL!" },
    note: "Calc cross-sheet bang intersection with no shared sheet is #NULL!",
  },
  {
    id: "xsheet-space",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: { A1: 1, B2: 5, D1: "=A1:C3 Sheet2!B2" },
        Sheet2: { B2: 50 },
      },
    },
    cell: "Sheet1!D1",
    expect: { error: "#NULL!" },
    note: "Calc cross-sheet space intersection with no shared sheet is #NULL!",
  },
  {
    id: "xsheet-null",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: { A1: "=Sheet1!A1:A2!Sheet2!C1:C2" },
        Sheet2: { C1: 9 },
      },
    },
    cell: "Sheet1!A1",
    expect: { error: "#NULL!" },
    note: "Calc empty cross-sheet intersection is #NULL!",
  },
  {
    id: "xsheet-3d-hit",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: { A1: 3, B1: "=Sheet1!A1:Sheet2!A1 Sheet1!A1" },
        Sheet2: { A1: 4 },
      },
    },
    cell: "Sheet1!B1",
    expect: 3,
    note: "Calc sheet-span intersect cell keeps the overlapping sheet cell",
  },
  {
    id: "x3d-other",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: { A1: 3, B1: "=Sheet1!A1:Sheet2!A1 Sheet2!A1" },
        Sheet2: { A1: 4 },
      },
    },
    cell: "Sheet1!B1",
    expect: 4,
    note: "Calc sheet-span intersect other-sheet cell keeps that sheet",
  },
  {
    id: "x3d-sum-both",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: { A1: 3, B1: "=SUM(Sheet1!A1:Sheet2!A1 Sheet1!A1:Sheet2!A1)" },
        Sheet2: { A1: 4 },
      },
    },
    cell: "Sheet1!B1",
    expect: 7,
    note: "Calc sheet-span intersect itself keeps both sheets",
  },
  {
    id: "sumif-union",
    pri: "P1",
    book: {
      sheets: { Sheet1: { A1: 1, B1: 2, C1: '=SUMIF((A1:A1~B1:B1),">0")' } },
    },
    cell: "Sheet1!C1",
    expect: 3,
    note: "Calc SUMIF accepts a ~ union criteria range",
  },
  {
    id: "sumif-overlap",
    pri: "P1",
    book: {
      sheets: { Sheet1: { A1: 1, A2: 2, B1: '=SUMIF((A1:A2~A1),">0")' } },
    },
    cell: "Sheet1!B1",
    expect: 4,
    note: "Calc SUMIF counts overlapping union cells twice",
  },
  {
    id: "countif-union",
    pri: "P1",
    book: {
      sheets: { Sheet1: { A1: 1, B1: 2, C1: '=COUNTIF((A1:A1~B1:B1),">0")' } },
    },
    cell: "Sheet1!C1",
    expect: 2,
    note: "Calc COUNTIF accepts a ~ union",
  },
  {
    id: "averageif-union",
    pri: "P1",
    book: {
      sheets: { Sheet1: { A1: 1, B1: 5, C1: '=AVERAGEIF((A1:A1~B1:B1),">0")' } },
    },
    cell: "Sheet1!C1",
    expect: 3,
    note: "Calc AVERAGEIF accepts a ~ union",
  },
  {
    id: "scalar-3d-offaxis",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: { A1: 3, B3: "=Sheet1!A1:Sheet2!A1" },
        Sheet2: { A1: 4 },
      },
    },
    cell: "Sheet1!B3",
    expect: { error: "#VALUE!" },
    note: "Calc scalar sheet-span needs shared row or column with the formula cell",
  },
  {
    id: "numtext-comma",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '="1,000"+0' } } },
    cell: "Sheet1!A1",
    expect: 1000,
    note: "Calc coerces thousands commas in arithmetic text",
  },
  {
    id: "numtext-comma-dec",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '="1,000.50"+0' } } },
    cell: "Sheet1!A1",
    expect: 1000.5,
    note: "Calc coerces thousands commas with a decimal",
  },
  {
    id: "numtext-dollar",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '="$1000"+0' } } },
    cell: "Sheet1!A1",
    expect: 1000,
    note: "Calc coerces a leading $ in arithmetic text",
  },
  {
    id: "numtext-dollar-space",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '="$ 1000"+0' } } },
    cell: "Sheet1!A1",
    expect: 1000,
    note: "Calc coerces $ then space then digits",
  },
  {
    id: "numtext-dollar-suffix",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '="1000$"+0' } } },
    cell: "Sheet1!A1",
    expect: 1000,
    note: "Calc coerces a trailing $",
  },
  {
    id: "numtext-parens",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '="(1000)"+0' } } },
    cell: "Sheet1!A1",
    expect: -1000,
    note: "Calc accounting parentheses are a negative sign",
  },
  {
    id: "numtext-parens-money",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '="($1,000.25)"+0' } } },
    cell: "Sheet1!A1",
    expect: -1000.25,
    note: "Calc combines $, commas, and accounting parentheses",
  },
  {
    id: "numtext-dollar-neg",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '="$-1,000"+0' } } },
    cell: "Sheet1!A1",
    expect: -1000,
    note: "Calc coerces $- with thousands commas",
  },
  {
    id: "numtext-bad-comma",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: '="1,5"+0' } } },
    cell: "Sheet1!A1",
    expect: { error: "#VALUE!" },
    note: "Calc rejects a comma that is not a thousands group",
  },
  {
    id: "paren-union-both",
    pri: "P1",
    book: {
      sheets: { Sheet1: { A1: 1, A2: 2, A3: 3, B1: "=SUM((A1:A2)~(A2:A3))" } },
    },
    cell: "Sheet1!B1",
    expect: 8,
    note: "Calc allows parentheses around each side of ~",
  },
  {
    id: "paren-union-left",
    pri: "P1",
    book: {
      sheets: { Sheet1: { A1: 1, A2: 2, A3: 3, B1: "=SUM((A1:A2)~A2:A3)" } },
    },
    cell: "Sheet1!B1",
    expect: 8,
    note: "Calc allows parentheses on the left of ~",
  },
  {
    id: "paren-union-right",
    pri: "P1",
    book: {
      sheets: { Sheet1: { A1: 1, A2: 2, A3: 3, B1: "=SUM(A1:A2~(A2:A3))" } },
    },
    cell: "Sheet1!B1",
    expect: 8,
    note: "Calc allows parentheses on the right of ~",
  },
  {
    id: "paren-intersect",
    pri: "P1",
    book: {
      sheets: {
        Sheet1: { A1: 1, B1: 10, C1: 30, D1: "=SUM((A1:C1)!(B1:B1))" },
      },
    },
    cell: "Sheet1!D1",
    expect: 10,
    note: "Calc allows parentheses around each side of !",
  },
  {
    id: "countif-sci",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 1e20, B1: '=COUNTIF(A1,"1E\\+020")' } } },
    cell: "Sheet1!B1",
    expect: 1,
    note: "Calc regex criteria match concatenation text of large numbers",
  },
  {
    id: "countif-small",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 1e-7, B1: '=COUNTIF(A1,"0\\.0000001")' } } },
    cell: "Sheet1!B1",
    expect: 1,
    note: "Calc regex criteria match concatenation text of small numbers",
  },
  {
    id: "countif-small-reject",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 1e-7, B1: '=COUNTIF(A1,"1[eE]-7")' } } },
    cell: "Sheet1!B1",
    expect: 0,
    note: "Calc does not match JS String(1e-7) for criteria",
  },
  {
    id: "match-sci",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 1e20, B1: '=MATCH("1E\\+020",A1,0)' } } },
    cell: "Sheet1!B1",
    expect: 1,
    note: "Calc MATCH regex uses concatenation number text",
  },
  {
    id: "sumif-sci",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: 1e20, B1: '=SUMIF(A1,"1E\\+020")' } } },
    cell: "Sheet1!B1",
    expect: 1e20,
    note: "Calc SUMIF regex uses concatenation number text",
  },
  {
    id: "vlookup-sci",
    pri: "P1",
    book: {
      sheets: { Sheet1: { A1: 1e20, B1: 5, C1: '=VLOOKUP("1E\\+020",A1:B1,2,FALSE)' } },
    },
    cell: "Sheet1!C1",
    expect: 5,
    note: "Calc VLOOKUP regex uses concatenation number text",
  },
  {
    id: "countif-neg-sci",
    pri: "P1",
    book: { sheets: { Sheet1: { A1: -1e20, B1: '=COUNTIF(A1,"-1E\\+020")' } } },
    cell: "Sheet1!B1",
    expect: 1,
    note: "Calc regex criteria match negative sci concatenation text",
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
