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

test("CONCATENATE joins text, numbers, and booleans", () => {
  const out = compute({
    A1: '=CONCATENATE("a","b","c")',
    A2: "=CONCATENATE(TRUE,FALSE)",
    A3: "=CONCATENATE(1,2)",
    A4: '=CONCATENATE(1/3,"")',
    A5: '=CONCATENATE(1E+20,"")',
    A6: "=CONCATENATE()",
    A7: '=CONCATENATE()&"x"',
    A8: '=CONCATENATE("a",, "b")',
    A9: '=CONCATENATE("a",1/0)',
    A10: "=CONCATENATE(B1)",
  });
  assert.equal(out.A1, "abc");
  assert.equal(out.A2, "10");
  assert.equal(out.A3, "12");
  assert.equal(out.A4, "0.333333333333333");
  assert.equal(out.A5, "1E+020");
  assert.equal(out.A6, "");
  assert.equal(out.A7, "x");
  assert.equal(out.A8, "ab");
  assert.deepEqual(out.A9, { error: "#DIV/0!" });
  assert.equal(out.A10, "");
});

test("LEFT takes the leading characters", () => {
  const out = compute({
    A1: '=LEFT("hello",2)',
    A2: '=LEFT("hello")',
    A3: '=LEFT("hello",0)',
    A4: '=LEFT("hello",-1)',
    A5: '=LEFT("hello",1.9)',
    A6: '=LEFT("hello",)',
    A7: "=LEFT(123,2)",
    A8: '=LEFT("hello",10)',
    A9: '=LEFT("a😀b",2)',
    A10: "=LEFT()",
    C1: "ab",
    C2: "xy",
    E1: "=LEFT(C1:C2,1)",
  });
  assert.equal(out.A1, "he");
  assert.equal(out.A2, "h");
  assert.equal(out.A3, "");
  assert.deepEqual(out.A4, { error: "#NUM!" });
  assert.equal(out.A5, "h");
  assert.equal(out.A6, "");
  assert.equal(out.A7, "12");
  assert.equal(out.A8, "hello");
  assert.equal(out.A9, "a😀");
  assert.deepEqual(out.A10, { error: "#VALUE!" });
  assert.equal(out.E1, "a");
});

test("RIGHT takes the trailing characters", () => {
  const out = compute({
    A1: '=RIGHT("hello",2)',
    A2: '=RIGHT("hello")',
    A3: '=RIGHT("hello",0)',
    A4: '=RIGHT("hello",-1)',
    A5: '=RIGHT("hello",1.2)',
    A6: '=RIGHT("hello",)',
    A7: "=RIGHT(12345)",
    A8: '=RIGHT("hello",10)',
    A9: "=RIGHT(TRUE,3)",
  });
  assert.equal(out.A1, "lo");
  assert.equal(out.A2, "o");
  assert.equal(out.A3, "");
  assert.deepEqual(out.A4, { error: "#NUM!" });
  assert.equal(out.A5, "o");
  assert.equal(out.A6, "");
  assert.equal(out.A7, "5");
  assert.equal(out.A8, "hello");
  assert.equal(out.A9, "1");
});

test("MID extracts a 1-based slice", () => {
  const out = compute({
    A1: '=MID("hello",2,3)',
    A2: '=MID("hello",1,0)',
    A3: '=MID("hello",0,1)',
    A4: '=MID("hello",1,-1)',
    A5: '=MID("hello",1.5,2.9)',
    A6: '=MID("abcd",2.9,1.1)',
    A7: '=MID("hello",10,2)',
    A8: '=MID("hello",6,1)',
    A9: '=MID("hello",2)',
    A10: '=MID("hello",5,2)',
    A11: '=MID("a😀b",2,1)',
    A12: '=MID("hello",-0.2,1)',
  });
  assert.equal(out.A1, "ell");
  assert.equal(out.A2, "");
  assert.deepEqual(out.A3, { error: "#NUM!" });
  assert.deepEqual(out.A4, { error: "#NUM!" });
  assert.equal(out.A5, "he");
  assert.equal(out.A6, "b");
  assert.equal(out.A7, "");
  assert.equal(out.A8, "");
  assert.deepEqual(out.A9, { error: "#VALUE!" });
  assert.equal(out.A10, "o");
  assert.equal(out.A11, "😀");
  assert.deepEqual(out.A12, { error: "#NUM!" });
});

test("LEN counts code points", () => {
  const out = compute({
    A1: '=LEN("hello")',
    A2: "=LEN(123)",
    A3: "=LEN(TRUE)",
    A4: "=LEN(FALSE)",
    A5: '=LEN("")',
    A6: "=LEN(B1)",
    A7: "=LEN(1/3)",
    A8: '=LEN("héllo")',
    A9: '=LEN("a😀b")',
    A10: "=LEN()",
    A11: '=LEN("a",1)',
  });
  assert.equal(out.A1, 5);
  assert.equal(out.A2, 3);
  assert.equal(out.A3, 1);
  assert.equal(out.A4, 1);
  assert.equal(out.A5, 0);
  assert.equal(out.A6, 0);
  assert.equal(out.A7, 17);
  assert.equal(out.A8, 5);
  assert.equal(out.A9, 3);
  assert.deepEqual(out.A10, { error: "#VALUE!" });
  assert.deepEqual(out.A11, { error: "#VALUE!" });
});

test("UPPER and LOWER change case", () => {
  const out = compute({
    A1: '=UPPER("AbC")',
    A2: "=UPPER(123)",
    A3: "=UPPER(TRUE)",
    A4: "=UPPER(B1)",
    A5: '=UPPER("héllo")',
    A6: '=LOWER("AbC")',
    A7: "=LOWER(FALSE)",
    A8: '=LOWER("héllo")',
    A9: "=UPPER(1/0)",
    A10: "=LOWER(-12)",
    A11: "=UPPER()",
  });
  assert.equal(out.A1, "ABC");
  assert.equal(out.A2, "123");
  assert.equal(out.A3, "1");
  assert.equal(out.A4, "");
  assert.equal(out.A5, "HÉLLO");
  assert.equal(out.A6, "abc");
  assert.equal(out.A7, "0");
  assert.equal(out.A8, "héllo");
  assert.deepEqual(out.A9, { error: "#DIV/0!" });
  assert.equal(out.A10, "-12");
  assert.deepEqual(out.A11, { error: "#VALUE!" });
});

test("TRIM drops outer spaces and collapses inner spaces", () => {
  const out = compute({
    A1: "  a   b  ",
    A2: "   ",
    A3: "a\u00a0b",
    A4: "a\tb",
    A5: "    a    b    ",
    A6: "  a  \n  b  ",
    B1: "=TRIM(A1)",
    B2: "=TRIM(A2)",
    B3: "=TRIM(A3)",
    B4: "=TRIM(A4)",
    B5: "=TRIM(A5)",
    B6: '=TRIM("")',
    B7: "=TRIM(C1)",
    B8: "=TRIM(123)",
    B9: "=TRIM(TRUE)",
    B10: "=TRIM()",
    B11: "=TRIM(A6)",
  });
  assert.equal(out.B1, "a b");
  assert.equal(out.B2, "");
  assert.equal(out.B3, "a\u00a0b");
  assert.equal(out.B4, "a\tb");
  assert.equal(out.B5, "a b");
  assert.equal(out.B6, "");
  assert.equal(out.B7, "");
  assert.equal(out.B8, "123");
  assert.equal(out.B9, "1");
  assert.deepEqual(out.B10, { error: "#VALUE!" });
  assert.equal(out.B11, "a \n b");
});
