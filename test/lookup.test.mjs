import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const engine = fileURLToPath(new URL("../engine", import.meta.url));

function compute(sheets) {
  const book = sheets.sheets ? sheets : { sheets: { Sheet1: sheets } };
  const res = spawnSync(engine, ["-"], {
    input: JSON.stringify(book),
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout).sheets;
}

test("MATCH exact returns the first hit and approximate keeps the last value that fits", () => {
  const out = compute({
    A1: 1,
    B1: "p",
    A2: 3,
    B2: "q",
    A3: 3,
    B3: "r",
    A4: 8,
    B4: "s",
    C1: "=MATCH(3,A1:A4,0)",
    C2: "=MATCH(4,A1:A4,0)",
    C3: "=MATCH(3,A1:A4,1)",
    C4: "=MATCH(4,A1:A4,1)",
    C5: "=MATCH(0,A1:A4,1)",
    C6: "=MATCH(4,A1:A4)",
    C7: "=MATCH(12,A1:A4,1)",
  }).Sheet1;
  assert.equal(out.C1, 2);
  assert.deepEqual(out.C2, { error: "#N/A" });
  assert.equal(out.C3, 3);
  assert.equal(out.C4, 3);
  assert.deepEqual(out.C5, { error: "#N/A" });
  assert.equal(out.C6, 3);
  assert.equal(out.C7, 4);
});

test("MATCH truncates its type and rejects a type other than -1, 0, or 1", () => {
  const out = compute({
    A1: 1,
    A2: 3,
    A3: 5,
    B1: "=MATCH(4,A1:A3,0.6)",
    B2: "=MATCH(4,A1:A3,1.9)",
    B3: "=MATCH(4,A1:A3,)",
    B4: "=MATCH(4,A1:A3,2)",
    B5: "=MATCH(4,A1:A3,-2)",
    B6: '=MATCH(4,A1:A3,"x")',
    B7: "=MATCH(5,A1:A3,FALSE)",
    B8: "=MATCH()",
    B9: "=MATCH(1)",
  }).Sheet1;
  assert.deepEqual(out.B1, { error: "#N/A" });
  assert.equal(out.B2, 2);
  assert.deepEqual(out.B3, { error: "#N/A" });
  assert.deepEqual(out.B4, { error: "#VALUE!" });
  assert.deepEqual(out.B5, { error: "#VALUE!" });
  assert.deepEqual(out.B6, { error: "#VALUE!" });
  assert.equal(out.B7, 3);
  assert.deepEqual(out.B8, { error: "#VALUE!" });
  assert.deepEqual(out.B9, { error: "#VALUE!" });
});

test("MATCH descending returns the last equal value in a sorted column", () => {
  const out = compute({
    A1: 9,
    A2: 8,
    A3: 8,
    A4: 1,
    B1: "=MATCH(8,A1:A4,-1)",
    B2: "=MATCH(8.5,A1:A4,-1)",
    B3: "=MATCH(0,A1:A4,-1)",
    B4: "=MATCH(10,A1:A4,-1)",
    B5: "=MATCH(8,A1:A4,1)",
  }).Sheet1;
  assert.equal(out.B1, 3);
  assert.equal(out.B2, 1);
  assert.equal(out.B3, 4);
  assert.deepEqual(out.B4, { error: "#N/A" });
  assert.deepEqual(out.B5, { error: "#N/A" });
});

test("MATCH text is case-insensitive and approximate uses text order", () => {
  const out = compute({
    A1: "apple",
    A2: "banana",
    A3: "Cherry",
    A4: "date",
    B1: '=MATCH("APPLE",A1:A4,0)',
    B2: '=MATCH("d",A1:A4,1)',
    B3: '=MATCH("aaa",A1:A4,1)',
    B4: '=MATCH("ap*",A1:A4,0)',
    B5: "=MATCH(3,A1:B2,0)",
    B6: "=MATCH(1,5,0)",
    B7: '=MATCH("ap?le",A1:A4,0)',
  }).Sheet1;
  assert.equal(out.B1, 1);
  assert.equal(out.B2, 3);
  assert.deepEqual(out.B3, { error: "#N/A" });
  assert.equal(out.B4, 1);
  assert.deepEqual(out.B5, { error: "#VALUE!" });
  assert.deepEqual(out.B6, { error: "#VALUE!" });
  assert.equal(out.B7, 1);
});

test("MATCH tilde escapes a literal star and does not crash", () => {
  const out = compute({
    A1: "a*b",
    A2: "ab",
    B1: '=MATCH("a~*b",A1:A2,0)',
    B2: '=MATCH("*~*",A1:A2,0)',
  }).Sheet1;
  assert.equal(out.B1, 1);
  assert.deepEqual(out.B2, { error: "#N/A" });
});

test("MATCH equates TRUE with 1 and numeric text with numbers only from the text side", () => {
  const out = compute({
    A1: "1",
    A2: 1,
    A3: " 1 ",
    B1: true,
    B2: false,
    C1: "1",
    D1: 2,
    E1: "2",
    F1: "=MATCH(1,A1:A3,0)",
    F2: '=MATCH("1",A1:A3,0)',
    F3: "=MATCH(1,B1:B2,0)",
    F4: "=MATCH(FALSE,B1:B2,0)",
    F5: '=MATCH("2",C1:E1,0)',
    F6: '=MATCH("2",C1:E1,1)',
    F7: "=MATCH(2,C1:E1,1)",
    F8: '=MATCH("1",C1:E1,1)',
    G1: 0,
    H1: "=MATCH(,G1,0)",
  }).Sheet1;
  assert.equal(out.F1, 2);
  assert.equal(out.F2, 1);
  assert.equal(out.F3, 1);
  assert.equal(out.F4, 2);
  assert.equal(out.F5, 2);
  assert.equal(out.F6, 3);
  assert.equal(out.F7, 2);
  assert.equal(out.F8, 1);
  assert.equal(out.H1, 1);
});

test("MATCH approximate on an unsorted column stops at the first larger value", () => {
  const out = compute({
    A1: 5,
    A2: 1,
    A3: 9,
    A4: 3,
    A5: 7,
    A6: 4,
    B1: "=MATCH(6,A1:A6,1)",
    B2: "=MATCH(1,A1:A6,1)",
    B3: "=MATCH(9,A1:A6,1)",
    B4: "=MATCH(5,A1:A6,0)",
    B5: "=MATCH(1/0,A1:A6,0)",
    C1: 1,
    C2: "=1/0",
    C3: 3,
    D1: "=MATCH(3,C1:C3,0)",
    D2: "=MATCH(3,C1:C3,1)",
    D3: "=MATCH(10,A1:A6,1)",
  }).Sheet1;
  assert.equal(out.B1, 2);
  assert.deepEqual(out.B2, { error: "#N/A" });
  assert.equal(out.B3, 3);
  assert.equal(out.B4, 1);
  assert.deepEqual(out.B5, { error: "#DIV/0!" });
  assert.equal(out.D1, 3);
  assert.equal(out.D2, 1);
  assert.equal(out.D3, 6);
});

test("INDEX reads a row and column, a column vector, and a row vector", () => {
  const out = compute({
    A1: 11,
    B1: 12,
    C1: 13,
    A2: 21,
    B2: 22,
    C2: 23,
    A3: 31,
    B3: 32,
    C3: 33,
    D1: "=INDEX(A1:C3,2,3)",
    D2: "=INDEX(A1:A3,2)",
    D3: "=INDEX(A1:C1,2)",
    D4: "=INDEX(A1:C3,2,1)",
    D5: "=INDEX(B2)",
    D6: "=INDEX(A1:C3)",
  }).Sheet1;
  assert.equal(out.D1, 23);
  assert.equal(out.D2, 21);
  assert.equal(out.D3, 12);
  assert.equal(out.D4, 21);
  assert.equal(out.D5, 22);
  assert.deepEqual(out.D6, { error: "#VALUE!" });
});

test("INDEX uses #REF! past the range and #VALUE! for a negative or multi-cell result", () => {
  const out = compute({
    A1: 11,
    B1: 12,
    C1: 13,
    A2: 21,
    B2: 22,
    C2: 23,
    D1: "=INDEX(A1:C2,3,1)",
    D2: "=INDEX(A1:C2,1,4)",
    D3: "=INDEX(A1:C2,-1,1)",
    D4: "=INDEX(A1:C2,2)",
    D5: "=INDEX(A1:C2,0,2)",
    D6: "=INDEX(A1:C1,0,2)",
    D7: "=INDEX(A1:A2,2,0)",
    D8: "=INDEX(42,1)",
    D9: "=INDEX(A1:A2,1,1,2)",
    D10: "=INDEX(A1:A2,1,1,0)",
    D11: "=INDEX()",
  }).Sheet1;
  assert.deepEqual(out.D1, { error: "#REF!" });
  assert.deepEqual(out.D2, { error: "#REF!" });
  assert.deepEqual(out.D3, { error: "#VALUE!" });
  assert.deepEqual(out.D4, { error: "#VALUE!" });
  assert.deepEqual(out.D5, { error: "#VALUE!" });
  assert.equal(out.D6, 12);
  assert.equal(out.D7, 21);
  assert.deepEqual(out.D8, { error: "#REF!" });
  assert.deepEqual(out.D9, { error: "#REF!" });
  assert.deepEqual(out.D10, { error: "#VALUE!" });
  assert.deepEqual(out.D11, { error: "#VALUE!" });
});

test("INDEX truncates indexes and treats zero as the whole axis", () => {
  const out = compute({
    A1: 11,
    B1: 12,
    C1: 13,
    A2: 21,
    B2: 22,
    C2: 23,
    D1: "=INDEX(A1:C2,1.2,2.8)",
    D2: "=INDEX(A1:C2,0.9,1)",
    D3: '=INDEX(A1:C2,"2","1")',
    D4: "=INDEX(A1:C2,TRUE,TRUE)",
    D5: "=INDEX(A1:A2,2,)",
    D6: "=INDEX(B1)",
    E1: "=1/0",
    D7: "=INDEX(E1,1)",
  }).Sheet1;
  assert.equal(out.D1, 12);
  assert.deepEqual(out.D2, { error: "#VALUE!" });
  assert.equal(out.D3, 21);
  assert.equal(out.D4, 11);
  assert.equal(out.D5, 21);
  assert.equal(out.D6, 12);
  assert.deepEqual(out.D7, { error: "#DIV/0!" });
});

test("VLOOKUP exact takes the first row and approximate takes the last row that fits", () => {
  const out = compute({
    A1: 1,
    B1: "p",
    A2: 3,
    B2: "q",
    A3: 3,
    B3: "r",
    A4: 8,
    B4: "s",
    C1: "=VLOOKUP(3,A1:B4,2,FALSE)",
    C2: "=VLOOKUP(4,A1:B4,2,FALSE)",
    C3: "=VLOOKUP(3,A1:B4,2,TRUE)",
    C4: "=VLOOKUP(4,A1:B4,2)",
    C5: "=VLOOKUP(4,A1:B4,2,)",
    C6: "=VLOOKUP(4,A1:B4,2,0.5)",
    C7: "=VLOOKUP(0,A1:B4,2,TRUE)",
    C8: "=VLOOKUP(3,A1:B4,1,FALSE)",
  }).Sheet1;
  assert.equal(out.C1, "q");
  assert.deepEqual(out.C2, { error: "#N/A" });
  assert.equal(out.C3, "r");
  assert.equal(out.C4, "r");
  assert.deepEqual(out.C5, { error: "#N/A" });
  assert.equal(out.C6, "r");
  assert.deepEqual(out.C7, { error: "#N/A" });
  assert.equal(out.C8, 3);
});

test("VLOOKUP rejects a column index outside the table and propagates errors", () => {
  const out = compute({
    A1: 5,
    B1: "s",
    A2: 77,
    B2: "=1/0",
    C1: "=VLOOKUP(5,A1:B1,0,FALSE)",
    C2: "=VLOOKUP(5,A1:B1,3,FALSE)",
    C3: "=VLOOKUP(5,A1:B1,1.9,FALSE)",
    C4: "=VLOOKUP(5,A1:B1,2.9,FALSE)",
    C5: "=VLOOKUP(5,A1:B1,-1,FALSE)",
    C6: "=VLOOKUP(77,A2:B2,2,FALSE)",
    C7: "=VLOOKUP(1/0,A1:B1,2,FALSE)",
    C8: "=VLOOKUP(5,A1:B1,1/0,FALSE)",
    C9: "=VLOOKUP(5,5,1,FALSE)",
    C10: "=VLOOKUP(5,A1:B1)",
  }).Sheet1;
  assert.deepEqual(out.C1, { error: "#VALUE!" });
  assert.deepEqual(out.C2, { error: "#VALUE!" });
  assert.equal(out.C3, 5);
  assert.equal(out.C4, "s");
  assert.deepEqual(out.C5, { error: "#VALUE!" });
  assert.deepEqual(out.C6, { error: "#DIV/0!" });
  assert.deepEqual(out.C7, { error: "#DIV/0!" });
  assert.deepEqual(out.C8, { error: "#DIV/0!" });
  assert.deepEqual(out.C9, { error: "#VALUE!" });
  assert.deepEqual(out.C10, { error: "#VALUE!" });
});

test("VLOOKUP matches text without case and reads another sheet", () => {
  const sheets = compute({
    sheets: {
      Sheet1: {
        A1: "apple",
        B1: 10,
        A2: "banana",
        B2: 20,
        C1: '=VLOOKUP("APPLE",A1:B2,2,FALSE)',
        C2: '=VLOOKUP("c",A1:B2,2,TRUE)',
        C3: "=VLOOKUP(9,Sheet2!A1:B2,2,FALSE)",
        C4: "=VLOOKUP(9,Missing!A1:B1,2,FALSE)",
      },
      Sheet2: { A1: 4, B1: "no", A2: 9, B2: "cross" },
    },
  });
  assert.equal(sheets.Sheet1.C1, 10);
  assert.equal(sheets.Sheet1.C2, 20);
  assert.equal(sheets.Sheet1.C3, "cross");
  assert.deepEqual(sheets.Sheet1.C4, { error: "#REF!" });
});
