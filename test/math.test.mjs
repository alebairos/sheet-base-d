import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const engine = fileURLToPath(new URL("../engine", import.meta.url));

function run(input) {
  return spawnSync(engine, ["-"], { input, encoding: "utf8", timeout: 5000 });
}

function compute(cells) {
  const res = run(JSON.stringify({ sheets: { Sheet1: cells } }));
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout).sheets.Sheet1;
}

test("AVERAGE averages a column range", () => {
  const out = compute({ A1: 1, A2: 2, A3: 3, B1: "=AVERAGE(A1:A3)" });
  assert.equal(out.B1, 2);
});

test("AVERAGE ignores blanks and text in a range", () => {
  const out = compute({ A1: 1, A3: 3, A4: "x", B1: "=AVERAGE(A1:A4)" });
  assert.equal(out.B1, 2);
});

test("AVERAGE rejects a text literal", () => {
  const out = compute({ A1: '=AVERAGE(1,"x",2)' });
  assert.deepEqual(out.A1, { error: "#VALUE!" });
});

test("AVERAGE of no numbers is #DIV/0!", () => {
  const out = compute({ A1: "=AVERAGE()", A2: "=AVERAGE(A3)" });
  assert.deepEqual(out.A1, { error: "#DIV/0!" });
  assert.deepEqual(out.A2, { error: "#DIV/0!" });
});

test("AVERAGE counts booleans as 1 and 0", () => {
  const out = compute({ A1: true, A2: false, B1: "=AVERAGE(A1:A2)", B2: "=AVERAGE(TRUE,FALSE)" });
  assert.equal(out.B1, 0.5);
  assert.equal(out.B2, 0.5);
});

test("MIN and MAX read a range and skip text", () => {
  const out = compute({
    A1: 3,
    A2: "x",
    A3: -5,
    B1: "=MIN(A1:A3)",
    B2: "=MAX(A1:A3)",
  });
  assert.equal(out.B1, -5);
  assert.equal(out.B2, 3);
});

test("MIN of only text cells is 0", () => {
  const out = compute({ A1: "x", A2: "y", B1: "=MIN(A1:A2)", B2: "=MAX(A1:A2)" });
  assert.equal(out.B1, 0);
  assert.equal(out.B2, 0);
});

test("MIN of a text literal is #VALUE!", () => {
  const out = compute({ A1: '=MIN("x")', A2: "=MIN()", A3: "=MAX()" });
  assert.deepEqual(out.A1, { error: "#VALUE!" });
  assert.deepEqual(out.A2, { error: "#VALUE!" });
  assert.deepEqual(out.A3, { error: "#VALUE!" });
});

test("MIN keeps the first value when a boolean ties a number", () => {
  const out = compute({
    A1: false,
    A2: 0,
    B1: "=MIN(A1,A2)",
    B2: "=MIN(A2,A1)",
    B3: "=MAX(A1,A2)",
    B4: "=MAX(A2,A1)",
  });
  assert.equal(out.B1, false);
  assert.equal(out.B2, 0);
  assert.equal(out.B3, false);
  assert.equal(out.B4, 0);
});

test("MIN and MAX of boolean literals return numbers", () => {
  const out = compute({
    A1: "=MIN(TRUE,FALSE)",
    A2: "=MAX(TRUE,FALSE)",
    A3: "=MIN(TRUE)",
    A4: "=MAX(FALSE,-1)",
    A5: "=MIN(TRUE(),FALSE())",
    A6: "=MAX(FALSE(),-1)",
  });
  assert.equal(out.A1, 0);
  assert.equal(out.A2, 1);
  assert.equal(out.A3, 1);
  assert.equal(out.A4, 0);
  assert.equal(out.A5, 0);
  assert.equal(out.A6, 0);
});

test("MIN and MAX keep a boolean when the first value is a boolean cell and the result is 0 or 1", () => {
  const out = compute({
    A1: "=TRUE()",
    B1: "=FALSE()",
    C1: "=MIN(A1)",
    C2: "=MIN(A1:B1)",
    C3: "=MIN(A1,0)",
    C4: "=MAX(B1,1)",
    C5: "=MIN(2,B1)",
    C6: "=MIN(TRUE,B1)",
    C7: "=MIN(A1,-5)",
    C8: "=MAX(B1,5)",
  });
  assert.equal(out.C1, true);
  assert.equal(out.C2, false);
  assert.equal(out.C3, false);
  assert.equal(out.C4, true);
  assert.equal(out.C5, 0);
  assert.equal(out.C6, 0);
  assert.equal(out.C7, -5);
  assert.equal(out.C8, 5);
});

test("COUNT counts numbers and booleans, not text cells", () => {
  const out = compute({
    A1: 1,
    A2: "5",
    A3: true,
    A4: false,
    B1: "=COUNT(A1:A4)",
    B2: "=COUNT()",
  });
  assert.equal(out.B1, 3);
  assert.equal(out.B2, 0);
});

test("COUNT counts a numeric text literal and ignores an error", () => {
  const out = compute({ A1: '=COUNT("5")', A2: '=COUNT("x")', A3: "=COUNT(1/0)" });
  assert.equal(out.A1, 1);
  assert.equal(out.A2, 0);
  assert.equal(out.A3, 0);
});

test("COUNTA counts text and errors and skips blanks", () => {
  const out = compute({
    A1: "x",
    A2: { error: "#DIV/0!" },
    B1: "=COUNTA(A1:A3)",
    B2: '=COUNTA("")',
    B3: "=COUNTA()",
  });
  assert.equal(out.B1, 2);
  assert.equal(out.B2, 1);
  assert.equal(out.B3, 0);
});

test("ROUND rounds half away from zero", () => {
  const out = compute({
    A1: "=ROUND(1.5,0)",
    A2: "=ROUND(-1.5,0)",
    A3: "=ROUND(1.005,2)",
    A4: "=ROUND(12345,-2)",
    A5: "=ROUND(1.234,1.9)",
  });
  assert.equal(out.A1, 2);
  assert.equal(out.A2, -2);
  assert.equal(out.A3, 1.01);
  assert.equal(out.A4, 12300);
  assert.equal(out.A5, 1.2);
});

test("ROUNDUP rounds away from zero and ROUNDDOWN toward zero", () => {
  const out = compute({
    A1: "=ROUNDUP(1.1,0)",
    A2: "=ROUNDUP(-1.1,0)",
    A3: "=ROUNDUP(10,-1)",
    A4: "=ROUNDDOWN(1.9,0)",
    A5: "=ROUNDDOWN(-1.9,0)",
    A6: "=ROUNDDOWN(1.005,2)",
  });
  assert.equal(out.A1, 2);
  assert.equal(out.A2, -2);
  assert.equal(out.A3, 10);
  assert.equal(out.A4, 1);
  assert.equal(out.A5, -1);
  assert.equal(out.A6, 1);
});

test("INT rounds toward negative infinity", () => {
  const out = compute({ A1: "=INT(8.9)", A2: "=INT(-8.9)", A3: '=INT("3.2")' });
  assert.equal(out.A1, 8);
  assert.equal(out.A2, -9);
  assert.equal(out.A3, 3);
});

test("MOD follows the sign of the divisor", () => {
  const out = compute({
    A1: "=MOD(-10,3)",
    A2: "=MOD(10,-3)",
    A3: "=MOD(-10,-3)",
    A4: "=MOD(5,0)",
    A5: "=MOD(0.3,0.1)",
  });
  assert.equal(out.A1, 2);
  assert.equal(out.A2, -2);
  assert.equal(out.A3, -1);
  assert.deepEqual(out.A4, { error: "#DIV/0!" });
  assert.equal(out.A5, 0);
});

test("ABS returns the magnitude", () => {
  const out = compute({ A1: "=ABS(-1.5)", A2: '=ABS("x")', A3: "=ABS(TRUE)" });
  assert.equal(out.A1, 1.5);
  assert.deepEqual(out.A2, { error: "#VALUE!" });
  assert.equal(out.A3, 1);
});

test("POWER matches Calc exponentiation", () => {
  const out = compute({
    A1: "=POWER(2,3)",
    A2: "=POWER(-8,1/3)",
    A3: "=POWER(-4,0.5)",
    A4: "=POWER(0,0)",
  });
  assert.equal(out.A1, 8);
  assert.equal(out.A2, -2);
  assert.deepEqual(out.A3, { error: "#NUM!" });
  assert.equal(out.A4, 1);
});

test("SQRT of a negative number is #NUM!", () => {
  const out = compute({ A1: "=SQRT(4)", A2: "=SQRT(-1)", A3: "=SQRT(0)" });
  assert.equal(out.A1, 2);
  assert.deepEqual(out.A2, { error: "#NUM!" });
  assert.equal(out.A3, 0);
});

test("PRODUCT multiplies numbers and rejects text literals", () => {
  const out = compute({
    A1: 2,
    A2: "x",
    A3: 3,
    B1: "=PRODUCT(A1:A3)",
    B2: '=PRODUCT(1,"x",2)',
    B3: "=PRODUCT()",
  });
  assert.equal(out.B1, 6);
  assert.deepEqual(out.B2, { error: "#VALUE!" });
  assert.equal(out.B3, 0);
});

test("SUMIF sums cells that match, including an omitted sum range", () => {
  const out = compute({
    A1: 1,
    A2: 2,
    A3: 3,
    B1: "=SUMIF(A1:A3,\">1\")",
    B2: "=SUMIF(A1:A3,\">1\",A1:A3)",
  });
  assert.equal(out.B1, 5);
  assert.equal(out.B2, 5);
});

test("SUMIF anchors the sum range at its top left", () => {
  const out = compute({
    A1: 1,
    A2: 5,
    A3: 10,
    A4: 5,
    B2: 200,
    B3: 300,
    B4: 400,
    B5: 500,
    C1: '=SUMIF(A1:A4,">5",B2)',
  });
  assert.equal(out.C1, 400);
});

test("SUMIF matches text without case and skips an error in the criteria range", () => {
  const out = compute({
    A1: "Apple",
    A2: "fig",
    A3: { error: "#DIV/0!" },
    B1: 10,
    B2: 20,
    B3: 30,
    C1: '=SUMIF(A1:A3,"apple",B1:B3)',
  });
  assert.equal(out.C1, 10);
});

test("COUNTIF criteria are regular expressions and still count blanks", () => {
  const out = compute({
    A1: "ab",
    A2: "a",
    A3: "ba",
    A5: 0,
    B1: '=COUNTIF(A1:A3,"a?")',
    B2: '=COUNTIF(A1:A3,"a*")',
    B3: '=COUNTIF(A4:A5,"")',
    B4: "=COUNTIF(A4:A5,0)",
    B5: '=COUNTIF(A4:A5,"=")',
    B6: '=COUNTIF(A1:A3,"a.*")',
    B7: '=COUNTIF(A1,"a?")',
    C1: 123,
    C2: "x",
    D1: '=COUNTIF(C1:C2,"*")',
    D2: '=COUNTIF(C1:C2,".*")',
  });
  assert.equal(out.B1, 1);
  assert.equal(out.B2, 1);
  assert.equal(out.B3, 1);
  assert.equal(out.B4, 1);
  assert.equal(out.B5, 1);
  assert.equal(out.B6, 2);
  assert.equal(out.B7, 0);
  assert.equal(out.D1, 0);
  assert.equal(out.D2, 2);
});

test("SUMIF and AVERAGEIF criteria are full-match regular expressions", () => {
  const out = compute({
    A1: "Apple",
    A2: "fig",
    B1: 10,
    B2: 20,
    C1: '=SUMIF(A1:A2,"a*",B1:B2)',
    C2: '=SUMIF(A1:A2,"a.*",B1:B2)',
    C3: '=AVERAGEIF(A1:A2,"a.*",B1:B2)',
  });
  assert.equal(out.C1, 0);
  assert.equal(out.C2, 10);
  assert.equal(out.C3, 10);
});

test("AVERAGEIF averages matches and returns #DIV/0! when none are numeric", () => {
  const out = compute({
    A1: 1,
    A2: 5,
    A3: 10,
    A4: "apple",
    B1: '=AVERAGEIF(A1:A3,">=5")',
    B2: '=AVERAGEIF(A1:A3,">100")',
    B3: '=AVERAGEIF(A4,"apple")',
  });
  assert.equal(out.B1, 7.5);
  assert.deepEqual(out.B2, { error: "#DIV/0!" });
  assert.deepEqual(out.B3, { error: "#DIV/0!" });
});

test("MEDIAN picks the middle or the mean of the two middle numbers", () => {
  const out = compute({
    A1: 1,
    A2: "x",
    A3: 3,
    A4: 2,
    B1: "=MEDIAN(A1:A4)",
    B2: "=MEDIAN(1,2,3,4)",
    B3: "=MEDIAN()",
  });
  assert.equal(out.B1, 2);
  assert.equal(out.B2, 2.5);
  assert.deepEqual(out.B3, { error: "#VALUE!" });
});

test("STDEV is the sample standard deviation", () => {
  const out = compute({
    A1: "=STDEV(1,2,3)",
    A2: "=STDEV(1)",
    A3: '=STDEV(1,"x",3)',
    A4: "=STDEV(0.1,0.2,0.3)",
  });
  assert.equal(out.A1, 1);
  assert.deepEqual(out.A2, { error: "#DIV/0!" });
  assert.deepEqual(out.A3, { error: "#VALUE!" });
  assert.equal(out.A4, 0.1);
});
