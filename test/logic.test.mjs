import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const engine = fileURLToPath(new URL("../engine", import.meta.url));

function compute(cells) {
  const res = spawnSync(engine, ["-"], {
    input: JSON.stringify({ sheets: { Sheet1: cells } }),
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout).sheets.Sheet1;
}

test("IF returns the taken branch and skips the other", () => {
  const out = compute({
    A1: "=IF(TRUE,1,1/0)",
    A2: "=IF(FALSE,1/0,2)",
    A3: "=IF(TRUE,1,B3)",
    B3: "=A3",
    A4: "=IF(FALSE,B4,2)",
    B4: "=A4",
    A5: "=IF(1/0,1,2)",
  });
  assert.equal(out.A1, 1);
  assert.equal(out.A2, 2);
  assert.equal(out.A3, 1);
  assert.equal(out.B3, 1);
  assert.equal(out.A4, 2);
  assert.equal(out.B4, 2);
  assert.deepEqual(out.A5, { error: "#DIV/0!" });
});

test("IF with one argument returns the condition as a boolean", () => {
  const out = compute({
    A1: "=IF(5)",
    A2: "=IF(0)",
    A3: "=IF(-3)",
    A4: "=IF(FALSE)",
    A5: '=IF("hello")',
    A6: "=IF()",
  });
  assert.equal(out.A1, true);
  assert.equal(out.A2, false);
  assert.equal(out.A3, true);
  assert.equal(out.A4, false);
  assert.deepEqual(out.A5, { error: "#VALUE!" });
  assert.deepEqual(out.A6, { error: "#VALUE!" });
});

test("IF with two arguments returns FALSE when the condition is false", () => {
  const out = compute({
    A1: "=IF(TRUE,7)",
    A2: "=IF(FALSE,7)",
    A3: '=IF(FALSE,7)&"x"',
    A4: "=IF(TRUE,,2)",
    A5: '=IF(TRUE,)&"x"',
    A6: "=ISBLANK(IF(TRUE,))",
  });
  assert.equal(out.A1, 7);
  assert.equal(out.A2, false);
  assert.equal(out.A3, "0x");
  assert.equal(out.A4, 0);
  assert.equal(out.A5, "x");
  assert.equal(out.A6, true);
});

test("IF coerces blank and numeric text", () => {
  const out = compute({
    A1: "=IF(A2,10,20)",
    A3: '=IF("1",10,20)',
    A4: '=IF("0",10,20)',
    A5: '=IF(" true ",10,20)',
    A6: '=IF("",10,20)',
    A7: '=IF(" ",10,20)',
    B1: "=IF(A1:A2,\"y\",\"n\")",
    B2: "=IF(A1:A2,\"y\",\"n\")",
    C4: "=IF(A1:A2,\"y\",\"n\")",
  });
  assert.equal(out.A1, 20);
  assert.equal(out.A3, 10);
  assert.equal(out.A4, 20);
  assert.equal(out.A5, 10);
  assert.deepEqual(out.A6, { error: "#VALUE!" });
  assert.deepEqual(out.A7, { error: "#VALUE!" });
  assert.equal(out.B2, "n");
  assert.deepEqual(out.C4, { error: "#VALUE!" });
});

test("IFERROR returns the fallback only when the value is an error", () => {
  const out = compute({
    A1: "=IFERROR(1,1/0)",
    A2: "=IFERROR(1/0,7)",
    A3: "=IFERROR(1,B3)",
    B3: "=A3",
    A4: "=IFERROR(SQRT(-1),3)",
    A5: "=IFERROR(NA(),5)",
    A6: '=IFERROR("a",9)',
    A7: "=IFERROR(1)",
    A8: "=IFERROR(1,2,3)",
    A9: "=IFERROR(FALSE,1)",
  });
  assert.equal(out.A1, 1);
  assert.equal(out.A2, 7);
  assert.equal(out.A3, 1);
  assert.equal(out.B3, 1);
  assert.equal(out.A4, 3);
  assert.equal(out.A5, 5);
  assert.equal(out.A6, "a");
  assert.deepEqual(out.A7, { error: "#VALUE!" });
  assert.deepEqual(out.A8, { error: "#VALUE!" });
  assert.equal(out.A9, false);
});

test("AND and OR combine numbers and booleans", () => {
  const out = compute({
    A1: "=AND(TRUE,TRUE)",
    A2: "=AND(TRUE,FALSE)",
    A3: "=AND(1,0)",
    A4: "=AND(-1)",
    A5: "=OR(FALSE,FALSE)",
    A6: "=OR(FALSE,TRUE)",
    A7: "=OR(0,0)",
    A8: "=OR(-1)",
  });
  assert.equal(out.A1, true);
  assert.equal(out.A2, false);
  assert.equal(out.A3, false);
  assert.equal(out.A4, true);
  assert.equal(out.A5, false);
  assert.equal(out.A6, true);
  assert.equal(out.A7, false);
  assert.equal(out.A8, true);
});

test("AND and OR ignore blanks and text in a range and reject scalar text", () => {
  const out = compute({
    A1: "x",
    A2: 1,
    A3: true,
    B1: "=AND(A1:A3)",
    B2: "=AND(A4:A5)",
    B3: "=AND(A4)",
    B4: "=AND(A4,TRUE)",
    B5: '=AND("1")',
    B6: '=AND("x",TRUE)',
    C1: "=OR(A1,0)",
    C2: "=OR(A6:A7)",
    C3: "=AND()",
    C4: "=OR()",
    C5: "=AND(TRUE,)",
    C6: "=OR(FALSE,)",
    C7: "=AND(,)",
  });
  assert.equal(out.B1, true);
  assert.deepEqual(out.B2, { error: "#VALUE!" });
  assert.deepEqual(out.B3, { error: "#VALUE!" });
  assert.equal(out.B4, true);
  assert.deepEqual(out.B5, { error: "#VALUE!" });
  assert.deepEqual(out.B6, { error: "#VALUE!" });
  assert.equal(out.C1, false);
  assert.deepEqual(out.C2, { error: "#VALUE!" });
  assert.deepEqual(out.C3, { error: "#VALUE!" });
  assert.deepEqual(out.C4, { error: "#VALUE!" });
  assert.equal(out.C5, false);
  assert.equal(out.C6, false);
  assert.equal(out.C7, false);
});

test("AND and OR evaluate every argument", () => {
  const out = compute({
    A1: "=AND(FALSE,1/0)",
    A2: "=OR(TRUE,1/0)",
    A3: { error: "#DIV/0!" },
    A4: 1,
    B1: "=AND(A3:A4)",
    B2: "=OR(A3)",
  });
  assert.deepEqual(out.A1, { error: "#DIV/0!" });
  assert.deepEqual(out.A2, { error: "#DIV/0!" });
  assert.deepEqual(out.B1, { error: "#DIV/0!" });
  assert.deepEqual(out.B2, { error: "#DIV/0!" });
});

test("NOT inverts a logical value", () => {
  const out = compute({
    A1: "=NOT(TRUE)",
    A2: "=NOT(0)",
    A3: "=NOT(2)",
    A4: '=NOT("x")',
    A5: '=NOT("")',
    A6: '=NOT(" FALSE ")',
    A7: "=NOT(B1)",
    A8: "=NOT()",
    A9: "=NOT(TRUE,FALSE)",
  });
  assert.equal(out.A1, false);
  assert.equal(out.A2, true);
  assert.equal(out.A3, false);
  assert.deepEqual(out.A4, { error: "#VALUE!" });
  assert.deepEqual(out.A5, { error: "#VALUE!" });
  assert.equal(out.A6, true);
  assert.equal(out.A7, true);
  assert.deepEqual(out.A8, { error: "#VALUE!" });
  assert.deepEqual(out.A9, { error: "#VALUE!" });
});

test("ISBLANK is true only for a blank cell", () => {
  const out = compute({
    A1: "=ISBLANK(B1)",
    A2: '=ISBLANK("")',
    A3: "=ISBLANK(0)",
    A4: '=ISBLANK(" ")',
    A5: "=ISBLANK(1/0)",
    A6: "=ISBLANK()",
    C3: "=ISBLANK(B1:B3)",
  });
  assert.equal(out.A1, true);
  assert.equal(out.A2, false);
  assert.equal(out.A3, false);
  assert.equal(out.A4, false);
  assert.equal(out.A5, false);
  assert.deepEqual(out.A6, { error: "#VALUE!" });
  assert.equal(out.C3, true);
});

test("ISNUMBER accepts numbers and booleans", () => {
  const out = compute({
    A1: "=ISNUMBER(1)",
    A2: "=ISNUMBER(TRUE)",
    A3: "=ISNUMBER(FALSE)",
    A4: '=ISNUMBER("1")',
    A5: "=ISNUMBER(B1)",
    A6: "=ISNUMBER(1/0)",
    A7: "=ISNUMBER()",
  });
  assert.equal(out.A1, true);
  assert.equal(out.A2, true);
  assert.equal(out.A3, true);
  assert.equal(out.A4, false);
  assert.equal(out.A5, false);
  assert.equal(out.A6, false);
  assert.deepEqual(out.A7, { error: "#VALUE!" });
});

test("ISTEXT accepts text including an empty string", () => {
  const out = compute({
    A1: '=ISTEXT("a")',
    A2: '=ISTEXT("")',
    A3: "=ISTEXT(1)",
    A4: "=ISTEXT(TRUE)",
    A5: "=ISTEXT(B1)",
    A6: "=ISTEXT(1/0)",
  });
  assert.equal(out.A1, true);
  assert.equal(out.A2, true);
  assert.equal(out.A3, false);
  assert.equal(out.A4, false);
  assert.equal(out.A5, false);
  assert.equal(out.A6, false);
});

test("ISERROR is true for any error and false otherwise", () => {
  const out = compute({
    A1: "=ISERROR(1/0)",
    A2: "=ISERROR(SQRT(-1))",
    A3: "=ISERROR(NA())",
    A4: "=ISERROR(1)",
    A5: '=ISERROR("")',
    A6: "=ISERROR(B1)",
    A7: "=ISERROR(FALSE)",
    C4: "=ISERROR(A1:A2)",
  });
  assert.equal(out.A1, true);
  assert.equal(out.A2, true);
  assert.equal(out.A3, true);
  assert.equal(out.A4, false);
  assert.equal(out.A5, false);
  assert.equal(out.A6, false);
  assert.equal(out.A7, false);
  assert.equal(out.C4, true);
});
