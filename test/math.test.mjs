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

function computeBook(book) {
  const res = run(JSON.stringify(book));
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout).sheets;
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

test("SQRT(2)^2 is 2 and the 15-digit root still prints as itself", () => {
  const out = compute({
    A1: "=SQRT(2)^2",
    A2: "=SQRT(2)^2=2",
    A3: "=SQRT(2)*SQRT(2)=2",
    A4: "=POWER(SQRT(2),2)",
    A5: "=(2^0.5)^2=2",
    A6: "=SQRT(2)",
    B6: "=A6^2",
    A7: "=1.4142135623731^2=2",
  });
  assert.equal(out.A1, 2);
  assert.equal(out.A2, true);
  assert.equal(out.A3, true);
  assert.equal(out.A4, 2);
  assert.equal(out.A5, true);
  assert.equal(out.A6, 1.4142135623731);
  assert.equal(out.B6, 2);
  assert.equal(out.A7, false);
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

test("COUNTIF counts both sides of a collation tie for <= and >=", () => {
  const out = compute({
    A1: "i\u0301",
    A2: "\u00ed",
    B1: '=COUNTIF(A1:A2,">=\u00ed")',
    B2: '=COUNTIF(A1:A2,"<\u00ed")',
    B3: '=COUNTIF(A1:A2,">\u00ed")',
    B4: '=COUNTIF(A1:A2,"<=\u00ed")',
  });
  assert.equal(out.B1, 2);
  assert.equal(out.B2, 0);
  assert.equal(out.B3, 0);
  assert.equal(out.B4, 2);
});

test("COUNTIF greater-than counts letters after an accented letter", () => {
  const out = compute({
    A1: "f",
    A2: "é",
    A3: "a",
    B1: '=COUNTIF(A1:A3,">é")',
  });
  assert.equal(out.B1, 1);
});

test("COUNTIF does not treat ß as ss", () => {
  const out = compute({
    A1: "ss",
    A2: "ß",
    B1: '=COUNTIF(A1,"ß")',
    B2: '=COUNTIF(A2,"ß")',
    B3: '=COUNTIF(A1,"SS")',
  });
  assert.equal(out.B1, 0);
  assert.equal(out.B2, 1);
  assert.equal(out.B3, 1);
});

test("COUNTIF (?-i) matches one case and (?i) still matches all cases", () => {
  const out = compute({
    A1: "Apple",
    A2: "apple",
    A3: "APPLE",
    B1: '=COUNTIF(A1:A3,"(?-i)apple")',
    B2: '=COUNTIF(A1:A3,"(?i)apple")',
  });
  assert.equal(out.B1, 1);
  assert.equal(out.B2, 3);
});

test("inline regex flags apply from the point they appear", () => {
  const out = compute({
    A1: "Ab",
    A2: "AB",
    A3: "ab",
    A4: "a\nb",
    A5: "ab",
    A6: "a b",
    B1: 1,
    B2: 1,
    B3: 1,
    C1: '=COUNTIF(A1:A3,"(?i)a(?-i)b")',
    C2: '=COUNTIF(A1:A3,"(?-i)(?i)ab")',
    C3: '=COUNTIF(A4,"(?s)a.b")',
    C4: '=COUNTIF(A5,"(?x)a b")',
    C5: '=COUNTIF(A4,"a.b")',
    C6: '=MATCH("(?i)a(?-i)b",A1:A3,0)',
    C7: '=SUMIF(A1:A3,"(?i)a(?-i)b",B1:B3)',
    C8: '=COUNTIF(A6,"(?x)a b")',
    D1: "(",
    D2: '=COUNTIF(D1,"[(?i)ab]")',
  });
  assert.equal(out.C1, 2);
  assert.equal(out.C2, 3);
  assert.equal(out.C3, 1);
  assert.equal(out.C4, 1);
  assert.equal(out.C5, 0);
  assert.equal(out.C6, 1);
  assert.equal(out.C7, 2);
  assert.equal(out.C8, 0);
  assert.equal(out.D2, 1);
});

test("a dangling quantifier matches nothing unless the pattern is one character", () => {
  const out = compute({
    A1: "*a",
    A2: "xa",
    A3: "ba",
    A4: "**",
    A5: "(a",
    A6: "(",
    A7: "+",
    A8: "+a",
    A9: "aa",
    A10: "[a",
    A11: "[",
    A12: "a**",
    B1: 3,
    C1: '=COUNTIF(A1,"*a")',
    C2: '=COUNTIF(A2,"*a")',
    C3: '=COUNTIF(A1:A3,"*a")',
    C4: '=COUNTIF(A4,"**")',
    C5: '=COUNTIF(A5,"(a")',
    C6: '=COUNTIF(A6,"(")',
    C7: '=COUNTIF(A7,"+")',
    C8: '=COUNTIF(A8,"+a")',
    C9: '=COUNTIF(A9,"a*")',
    C10: '=COUNTIF(A10,"[a")',
    C11: '=COUNTIF(A11,"[")',
    C12: '=COUNTIF(A12,"a**")',
    C13: '=COUNTIF(A9,"a**")',
    C14: '=COUNTIF(A1,"*")',
    C15: '=COUNTIF(A1,"(?i)*a")',
    C16: '=MATCH("*a",A1,0)',
    C17: '=SUMIF(A1,"*a",B1)',
  });
  assert.equal(out.C1, 0);
  assert.equal(out.C2, 0);
  assert.equal(out.C3, 0);
  assert.equal(out.C4, 0);
  assert.equal(out.C5, 0);
  assert.equal(out.C6, 1);
  assert.equal(out.C7, 1);
  assert.equal(out.C8, 0);
  assert.equal(out.C9, 1);
  assert.equal(out.C10, 0);
  assert.equal(out.C11, 1);
  assert.equal(out.C12, 0);
  assert.equal(out.C13, 0);
  assert.equal(out.C14, 0);
  assert.equal(out.C15, 0);
  assert.deepEqual(out.C16, { error: "#N/A" });
  assert.equal(out.C17, 0);
});

test("a lone caret, dollar, or pipe is a literal character", () => {
  const out = compute({
    A1: "^",
    A2: "$",
    A3: "|",
    A4: "a",
    A5: "b",
    A6: '=""',
    A7: "^a",
    A8: "^^",
    B1: 5,
    C1: '=COUNTIF(A1,"^")',
    C2: '=COUNTIF(A2,"$")',
    C3: '=COUNTIF(A3,"|")',
    C4: '=COUNTIF(A6,"^")',
    C5: '=COUNTIF(A6,"|")',
    C6: '=COUNTIF(A6,"$")',
    C7: '=COUNTIF(A4,"^")',
    C8: '=COUNTIF(A4,"^a")',
    C9: '=COUNTIF(A7,"^a")',
    C10: '=COUNTIF(A4:A5,"a|b")',
    C11: '=COUNTIF(A6,"^^")',
    C12: '=COUNTIF(A8,"^^")',
    C13: '=MATCH("^",A1,0)',
    C14: '=MATCH("^",A6,0)',
    C15: '=SUMIF(A1,"^",B1)',
    C16: '=VLOOKUP("^",A1:B1,2,FALSE)',
    C17: '=COUNTIF(A9,"^")',
  });
  assert.equal(out.C1, 1);
  assert.equal(out.C2, 1);
  assert.equal(out.C3, 1);
  assert.equal(out.C4, 0);
  assert.equal(out.C5, 0);
  assert.equal(out.C6, 0);
  assert.equal(out.C7, 0);
  assert.equal(out.C8, 1);
  assert.equal(out.C9, 0);
  assert.equal(out.C10, 2);
  assert.equal(out.C11, 1);
  assert.equal(out.C12, 0);
  assert.equal(out.C13, 1);
  assert.deepEqual(out.C14, { error: "#N/A" });
  assert.equal(out.C15, 5);
  assert.equal(out.C16, 5);
  assert.equal(out.C17, 0);
});

test("the first regex match counts only when it covers the whole text", () => {
  const out = compute({
    A1: "a",
    A2: "b",
    A3: "ab",
    A4: '=""',
    C1: 5,
    B1: '=COUNTIF(A1,"|a")',
    B2: '=COUNTIF(A4,"|a")',
    B3: '=COUNTIF(A2,"a||b")',
    B4: '=COUNTIF(A1,"a||b")',
    B5: '=COUNTIF(A4,"a||b")',
    B6: '=COUNTIF(A3,"a|ab")',
    B7: '=COUNTIF(A3,"ab|a")',
    B8: '=COUNTIF(A1,"(|a)")',
    B9: '=COUNTIF(A1,"(a|)")',
    B10: '=COUNTIF(A4,"(a|)")',
    B11: '=COUNTIF(A1,"a|")',
    B12: '=COUNTIF(A4,"a|")',
    B13: '=COUNTIF(A1,"a*?")',
    B14: '=COUNTIF(A4,"a*?")',
    B15: '=MATCH("|a",A1,0)',
    B16: '=SUMIF(A1,"|a",C1)',
    B17: '=COUNTIF(A1,"a|b")',
    B18: '=COUNTIF(A2,"a|b")',
  });
  assert.equal(out.B1, 0);
  assert.equal(out.B2, 1);
  assert.equal(out.B3, 0);
  assert.equal(out.B4, 1);
  assert.equal(out.B5, 1);
  assert.equal(out.B6, 0);
  assert.equal(out.B7, 1);
  assert.equal(out.B8, 0);
  assert.equal(out.B9, 1);
  assert.equal(out.B10, 1);
  assert.equal(out.B11, 1);
  assert.equal(out.B12, 1);
  assert.equal(out.B13, 0);
  assert.equal(out.B14, 1);
  assert.deepEqual(out.B15, { error: "#N/A" });
  assert.equal(out.B16, 0);
  assert.equal(out.B17, 1);
  assert.equal(out.B18, 1);
});

test("SUMIF, COUNTIF, and AVERAGEIF accept a union criteria range", () => {
  const out = compute({
    A1: 1,
    B1: 2,
    C1: '=SUMIF((A1:A1~B1:B1),">0")',
    C2: '=COUNTIF((A1:A1~B1:B1),">0")',
    A2: 1,
    B2: 5,
    C3: '=AVERAGEIF((A2:A2~B2:B2),">0")',
    A4: 1,
    B4: 1,
    D4: 1,
    C4: '=COUNTIF((A4~B4~D4),">0")',
  });
  assert.equal(out.C1, 3);
  assert.equal(out.C2, 2);
  assert.equal(out.C3, 3);
  assert.equal(out.C4, 3);
});

test("SUMIF counts an overlapping union cell twice", () => {
  const out = compute({
    A1: 1,
    A2: 2,
    B1: '=SUMIF((A1:A2~A1),">0")',
    B2: '=COUNTIF((A1:A2~A1),">0")',
  });
  assert.equal(out.B1, 4);
  assert.equal(out.B2, 3);
});

test("a union criteria range can sit on two sheets", () => {
  const sheets = computeBook({
    sheets: {
      Sheet1: {
        A1: 1,
        B1: '=SUMIF((Sheet1!A1~Sheet2!A1),">0")',
        B2: '=COUNTIF((Sheet1!A1~Sheet2!A1),">0")',
        B3: '=AVERAGEIF((Sheet1!A1~Sheet2!A1),">0")',
      },
      Sheet2: { A1: 5 },
    },
  });
  assert.equal(sheets.Sheet1.B1, 6);
  assert.equal(sheets.Sheet1.B2, 2);
  assert.equal(sheets.Sheet1.B3, 3);
});

test("SUMIF, COUNTIF, and AVERAGEIF reject a sheet-span criteria range", () => {
  const sheets = computeBook({
    sheets: {
      Sheet1: {
        A1: 1,
        B1: '=SUMIF(Sheet1!A1:Sheet2!A1,">0")',
        B2: '=COUNTIF(Sheet1!A1:Sheet2!A1,">0")',
        B3: '=AVERAGEIF(Sheet1!A1:Sheet2!A1,">0")',
      },
      Sheet2: { A1: 2 },
    },
  });
  assert.deepEqual(sheets.Sheet1.B1, { error: "#VALUE!" });
  assert.deepEqual(sheets.Sheet1.B2, { error: "#VALUE!" });
  assert.deepEqual(sheets.Sheet1.B3, { error: "#VALUE!" });
});

test("SUMIF and AVERAGEIF reject a union when a sum range is given", () => {
  const out = compute({
    A1: 1,
    B1: 2,
    C1: 10,
    D1: 20,
    E1: '=SUMIF((A1:A1~B1:B1),">0",C1:D1)',
    E2: '=AVERAGEIF((A1:A1~B1:B1),">0",C1:D1)',
    E3: '=SUMIF(A1:A1,">0",(C1:C1~D1:D1))',
  });
  assert.deepEqual(out.E1, { error: "#VALUE!" });
  assert.deepEqual(out.E2, { error: "#VALUE!" });
  assert.deepEqual(out.E3, { error: "#VALUE!" });
});

test("COUNTIF, SUMIF, and AVERAGEIF accept an inline (?i) flag", () => {
  const out = compute({
    A1: "Apple",
    B1: 1,
    A2: "apple",
    B2: 1,
    A3: "APPLE",
    B3: 1,
    A4: "banana",
    B4: 1,
    C1: '=COUNTIF(A1:A4,"(?i)apple")',
    C2: '=SUMIF(A1:A4,"(?i)apple",B1:B4)',
    C3: '=AVERAGEIF(A1:A4,"(?i)apple",B1:B4)',
  });
  assert.equal(out.C1, 3);
  assert.equal(out.C2, 3);
  assert.equal(out.C3, 1);
});

test("arithmetic coerces en-US formatted number text", () => {
  const out = compute({
    A1: '="12"+0',
    A2: '="1e2"+0',
    A3: '="12%"+0',
    A4: '=" 12 "+0',
    A5: '="1,000"+0',
    A6: '="1,000.50"+0',
    A7: '="$1000"+0',
    A8: '="$ 1000"+0',
    A9: '="1000$"+0',
    A10: '="(1000)"+0',
    A11: '="($1,000.25)"+0',
    A12: '="$-1,000"+0',
    A13: '="(1e2)"+0',
    A14: '="1,000e2"+0',
    A15: '="50%"+0',
  });
  assert.equal(out.A1, 12);
  assert.equal(out.A2, 100);
  assert.equal(out.A3, 0.12);
  assert.equal(out.A4, 12);
  assert.equal(out.A5, 1000);
  assert.equal(out.A6, 1000.5);
  assert.equal(out.A7, 1000);
  assert.equal(out.A8, 1000);
  assert.equal(out.A9, 1000);
  assert.equal(out.A10, -1000);
  assert.equal(out.A11, -1000.25);
  assert.equal(out.A12, -1000);
  assert.equal(out.A13, -100);
  assert.equal(out.A14, 100000);
  assert.equal(out.A15, 0.5);
});

test("arithmetic coerces mixed fractions and a unicode minus", () => {
  const out = compute({
    A1: '="1 1/2"+0',
    A2: '="-1 1/2"+0',
    A3: '="(1 1/2)"+0',
    A4: '="1 1 / 2"+0',
    A5: '="1 10/2"+0',
    A6: '="\u22121"+0',
    A7: '="\u22121,000"+0',
    A8: '="\u22121 1/2"+0',
    A9: '="\u2212 1"+0',
  });
  assert.equal(out.A1, 1.5);
  assert.equal(out.A2, -1.5);
  assert.equal(out.A3, -1.5);
  assert.equal(out.A4, 1.5);
  assert.equal(out.A5, 6);
  assert.equal(out.A6, -1);
  assert.equal(out.A7, -1000);
  assert.equal(out.A8, -1.5);
  assert.equal(out.A9, -1);
});

test("arithmetic rejects mixed-fraction text that stays text", () => {
  const out = compute({
    A1: '=" 1 1/2"+0',
    A2: '="1 1/2%"+0',
    A3: '="1 1/0"+0',
    A4: '="(-1 1/2)"+0',
    A5: '="½"+0',
    A6: '="1/2"+0',
  });
  assert.deepEqual(out.A1, { error: "#VALUE!" });
  assert.deepEqual(out.A2, { error: "#VALUE!" });
  assert.deepEqual(out.A3, { error: "#VALUE!" });
  assert.deepEqual(out.A4, { error: "#VALUE!" });
  assert.deepEqual(out.A5, { error: "#VALUE!" });
  assert.deepEqual(out.A6, { error: "#VALUE!" });
});

test("arithmetic rejects malformed number text", () => {
  const out = compute({
    A1: '="1,5"+0',
    A2: '="1,00"+0',
    A3: '="€100"+0',
    A4: '="1,2,3"+0',
    A5: '="(1000"+0',
  });
  assert.deepEqual(out.A1, { error: "#VALUE!" });
  assert.deepEqual(out.A2, { error: "#VALUE!" });
  assert.deepEqual(out.A3, { error: "#VALUE!" });
  assert.deepEqual(out.A4, { error: "#VALUE!" });
  assert.deepEqual(out.A5, { error: "#VALUE!" });
});

test("arithmetic rejects illegal number-text adornment combinations", () => {
  const out = compute({
    A1: '="(-50)"+0',
    A2: '="(+50)"+0',
    A3: '="($-50)"+0',
    A4: '="(50%)"+0',
    A5: '="$50%"+0',
    A6: '="$1e2"+0',
    A7: '="1e2$"+0',
    A8: '="1e2%"+0',
    A9: '="1,000 1/2"+0',
    A10: '="$1 1/2"+0',
    A11: '="($1 1/2)"+0',
  });
  assert.deepEqual(out.A1, { error: "#VALUE!" });
  assert.deepEqual(out.A2, { error: "#VALUE!" });
  assert.deepEqual(out.A3, { error: "#VALUE!" });
  assert.deepEqual(out.A4, { error: "#VALUE!" });
  assert.deepEqual(out.A5, { error: "#VALUE!" });
  assert.deepEqual(out.A6, { error: "#VALUE!" });
  assert.deepEqual(out.A7, { error: "#VALUE!" });
  assert.deepEqual(out.A8, { error: "#VALUE!" });
  assert.deepEqual(out.A9, { error: "#VALUE!" });
  assert.deepEqual(out.A10, { error: "#VALUE!" });
  assert.deepEqual(out.A11, { error: "#VALUE!" });
});

test("regex criteria match a number the way concatenation prints it", () => {
  const out = compute({
    A1: 1e20,
    B1: 5,
    A2: 1e-7,
    A3: -1e20,
    C1: '=A1&""',
    C2: '=COUNTIF(A1,"1E\\+020")',
    C3: '=SUMIF(A1,"1E\\+020")',
    C4: '=MATCH("1E\\+020",A1,0)',
    C5: '=VLOOKUP("1E\\+020",A1:B1,2,FALSE)',
    C6: '=A2&""',
    C7: '=COUNTIF(A2,"0\\.0000001")',
    C8: '=COUNTIF(A2,"1[eE]-7")',
    C9: '=A3&""',
    C10: '=COUNTIF(A3,"-1E\\+020")',
  });
  assert.equal(out.C1, "1E+020");
  assert.equal(out.C2, 1);
  assert.equal(out.C3, 1e20);
  assert.equal(out.C4, 1);
  assert.equal(out.C5, 5);
  assert.equal(out.C6, "0.0000001");
  assert.equal(out.C7, 1);
  assert.equal(out.C8, 0);
  assert.equal(out.C9, "-1E+020");
  assert.equal(out.C10, 1);
});

test("COUNTIF, SUMIF, and AVERAGEIF keep spaces on a numeric criterion", () => {
  const out = compute({
    A1: " 2",
    B1: 10,
    A2: "2",
    B2: 20,
    A3: 2,
    B3: 30,
    A4: "2 ",
    B4: 40,
    A5: " ",
    A7: "a",
    A8: " true",
    A9: " TRUE",
    C1: '=COUNTIF(A1," 2")',
    C2: '=COUNTIF(A2," 2")',
    C3: '=COUNTIF(A3," 2")',
    C4: '=COUNTIF(A1,"2")',
    C5: '=COUNTIF(A4,"2 ")',
    C6: '=COUNTIF(A2,"2 ")',
    C7: '=SUMIF(A1," 2",B1)',
    C8: '=AVERAGEIF(A1," 2",B1)',
    C9: '=SUMIF(A2," 2",B2)',
    C10: '=AVERAGEIF(A2," 2",B2)',
    C11: '=COUNTIF(A1,"= 2")',
    C12: '=COUNTIF(A2,"<> 2")',
    C13: '=COUNTIF(A1,"<> 2")',
    C14: '=COUNTIF(A6,"= ")',
    C15: '=COUNTIF(A5,"= ")',
    C16: '=COUNTIF(A6,"=")',
    C17: '=COUNTIF(A3,"> 1")',
    C18: '=COUNTIF(A1:A4," 2")',
    C19: '=SUMIF(A1:A4," 2",B1:B4)',
    C20: '=COUNTIF(A7,"> ")',
    C21: '=COUNTIF(A5,"> ")',
    C22: '=COUNTIF(A8," TRUE")',
    C23: '=COUNTIF(A9," true")',
  });
  assert.equal(out.C1, 1);
  assert.equal(out.C2, 0);
  assert.equal(out.C3, 1);
  assert.equal(out.C4, 0);
  assert.equal(out.C5, 1);
  assert.equal(out.C6, 0);
  assert.equal(out.C7, 10);
  assert.equal(out.C8, 10);
  assert.equal(out.C9, 0);
  assert.deepEqual(out.C10, { error: "#DIV/0!" });
  assert.equal(out.C11, 1);
  assert.equal(out.C12, 1);
  assert.equal(out.C13, 0);
  assert.equal(out.C14, 0);
  assert.equal(out.C15, 1);
  assert.equal(out.C16, 1);
  assert.equal(out.C17, 1);
  assert.equal(out.C18, 2);
  assert.equal(out.C19, 40);
  assert.equal(out.C20, 1);
  assert.equal(out.C21, 0);
  assert.equal(out.C22, 1);
  assert.equal(out.C23, 1);
});

test("numeric text keeps space and no-break spaces and rejects a tab", () => {
  const out = compute({
    A1: '="\t2"+0',
    A2: '="2\t"+0',
    A3: '="+\t2"+0',
    A4: '="2\t%"+0',
    A5: '="(\t2)"+0',
    A6: '="\u20032"+0',
    A7: '="\n2"+0',
    A8: '="\u00a02"+0',
    A9: '="\u202f2"+0',
    A10: '="+ 2"+0',
    A11: '="+\u00a02"+0',
    A12: '="2\u00a0%"+0',
    A13: '="( 2 )"+0',
    A14: '="(\u00a02)"+0',
    A15: '=" TRUE"+0',
    B1: 2,
    B2: 3,
    B3: 10,
    C1: '=COUNTIF(B1,"\t2")',
    C2: '=COUNTIF(B1,"2\t")',
    C3: '=COUNTIF(B2,">\t2")',
    C4: '=COUNTIF(B1,"\u00a02")',
    C5: '=COUNTIF(B1,"\u202f2")',
    C6: '=COUNTIF(B1,"\u20032")',
    C7: '=COUNTIF(D1,"\t2")',
    C8: '=SUMIF(B1,"\t2",B3)',
    C9: '=SUMIF(B1," 2",B3)',
    D1: "\t2",
  });
  assert.deepEqual(out.A1, { error: "#VALUE!" });
  assert.deepEqual(out.A2, { error: "#VALUE!" });
  assert.deepEqual(out.A3, { error: "#VALUE!" });
  assert.deepEqual(out.A4, { error: "#VALUE!" });
  assert.deepEqual(out.A5, { error: "#VALUE!" });
  assert.deepEqual(out.A6, { error: "#VALUE!" });
  assert.deepEqual(out.A7, { error: "#VALUE!" });
  assert.equal(out.A8, 2);
  assert.equal(out.A9, 2);
  assert.equal(out.A10, 2);
  assert.equal(out.A11, 2);
  assert.equal(out.A12, 0.02);
  assert.equal(out.A13, -2);
  assert.equal(out.A14, -2);
  assert.equal(out.A15, 1);
  assert.equal(out.C1, 0);
  assert.equal(out.C2, 0);
  assert.equal(out.C3, 0);
  assert.equal(out.C4, 1);
  assert.equal(out.C5, 1);
  assert.equal(out.C6, 0);
  assert.equal(out.C7, 1);
  assert.equal(out.C8, 0);
  assert.equal(out.C9, 10);
});

test("dollar and outside percent use the same numeric padding", () => {
  const out = compute({
    A1: '="$\u00a02"+0',
    A2: '="$\u202f2"+0',
    A3: '="$\u00a0+2"+0',
    A4: '="$\u202f-2"+0',
    A5: '="$\u00a0\u202f2"+0',
    A6: '="$\u00a01,000.5"+0',
    A7: '="(2)\u00a0%"+0',
    A8: '="(2)\u202f%\u202f"+0',
    A9: '="(\u00a02\u00a0)\u00a0%"+0',
    A10: '="(1.5)\u00a0%"+0',
    A11: '="($\u00a02)"+0',
    A12: '="+ $2"+0',
    A13: '="+\u00a0$2"+0',
    A14: '="-\u202f$\u202f2"+0',
    A15: '="$\t2"+0',
    A16: '="(2)\t%"+0',
    A17: '="+\t$2"+0',
    A18: '="$\u2003+2"+0',
    A19: '="($2)%"+0',
    A20: '="($\u00a0+2)"+0',
    A21: '="1\u00a01/2"+0',
    B1: 2,
    B2: -0.02,
    B3: -2,
    C1: '=COUNTIF(B1,"$\u00a02")',
    C2: '=COUNTIF(B2,"(2)\u00a0%")',
    C3: '=COUNTIF(B1,"+ $2")',
    C4: '=COUNTIF(B3,"-\u202f$\u202f2")',
    C5: '=COUNTIF(B1,"$\t2")',
    C6: '=COUNTIF(B1,"+\t$2")',
  });
  assert.equal(out.A1, 2);
  assert.equal(out.A2, 2);
  assert.equal(out.A3, 2);
  assert.equal(out.A4, -2);
  assert.equal(out.A5, 2);
  assert.equal(out.A6, 1000.5);
  assert.equal(out.A7, -0.02);
  assert.equal(out.A8, -0.02);
  assert.equal(out.A9, -0.02);
  assert.equal(out.A10, -0.015);
  assert.equal(out.A11, -2);
  assert.equal(out.A12, 2);
  assert.equal(out.A13, 2);
  assert.equal(out.A14, -2);
  assert.deepEqual(out.A15, { error: "#VALUE!" });
  assert.deepEqual(out.A16, { error: "#VALUE!" });
  assert.deepEqual(out.A17, { error: "#VALUE!" });
  assert.deepEqual(out.A18, { error: "#VALUE!" });
  assert.deepEqual(out.A19, { error: "#VALUE!" });
  assert.deepEqual(out.A20, { error: "#VALUE!" });
  assert.deepEqual(out.A21, { error: "#VALUE!" });
  assert.equal(out.C1, 1);
  assert.equal(out.C2, 1);
  assert.equal(out.C3, 1);
  assert.equal(out.C4, 1);
  assert.equal(out.C5, 0);
  assert.equal(out.C6, 0);
});

test("the first error Calc pops sticks for the rest of the formula", () => {
  const out = compute({
    A1: "=1/0",
    A2: "=SQRT(-1)",
    A3: '="a"+1',
    B1: "=A1+A2",
    B2: "=A2+A1",
    B3: "=(A1+A2)+A3",
    B4: "=A1+(A2+A3)",
    B5: "=SUM(A1,A2,A3)",
    B6: "=SUM(A1:A3)",
    B7: "=IFERROR(A1+A2,3)+A3",
    B8: "=ISNUMBER(1/0)+1",
    B9: "=IF(A1,1,2)+A2",
    B10: "=IF(TRUE,A1,9)+A3",
    B11: "=COUNT(1/0)+5",
    B12: "=MAX(A1,A2)",
    B13: "=MEDIAN(A1,A2,A3)",
  });
  assert.deepEqual(out.B1, { error: "#NUM!" });
  assert.deepEqual(out.B2, { error: "#DIV/0!" });
  assert.deepEqual(out.B3, { error: "#NUM!" });
  assert.deepEqual(out.B4, { error: "#VALUE!" });
  assert.deepEqual(out.B5, { error: "#VALUE!" });
  assert.deepEqual(out.B6, { error: "#DIV/0!" });
  assert.deepEqual(out.B7, { error: "#VALUE!" });
  assert.equal(out.B8, 1);
  assert.deepEqual(out.B9, { error: "#DIV/0!" });
  assert.deepEqual(out.B10, { error: "#VALUE!" });
  assert.equal(out.B11, 5);
  assert.deepEqual(out.B12, { error: "#NUM!" });
  assert.deepEqual(out.B13, { error: "#DIV/0!" });
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
