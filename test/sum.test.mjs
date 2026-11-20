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

test("SUM adds a column range", () => {
  const out = compute({ A1: 1, A2: 2, A3: 3, B1: "=SUM(A1:A3)" });
  assert.equal(out.B1, 6);
});

test("SUM treats blanks as 0", () => {
  const out = compute({ A1: 4, A3: 6, B1: "=SUM(A1:A3)" });
  assert.equal(out.B1, 10);
});

test("SUM skips text in a range", () => {
  const out = compute({ A1: 1, A2: "x", A3: 3, B1: "=SUM(A1:A3)" });
  assert.equal(out.B1, 4);
});

test("SUM rejects text literals", () => {
  const out = compute({ A1: '=SUM(1,"x",2)', B1: '=SUM("2")' });
  assert.deepEqual(out.A1, { error: "#VALUE!" });
  assert.deepEqual(out.B1, { error: "#VALUE!" });
});

test("SUM propagates the first error in a range", () => {
  const out = compute({ A1: 1, A2: { error: "#DIV/0!" }, A3: 3, B1: "=SUM(A1:A3)" });
  assert.deepEqual(out.B1, { error: "#DIV/0!" });
});

test("SUM propagates an error argument", () => {
  const out = compute({ A1: "=SUM(1/0, 2)" });
  assert.deepEqual(out.A1, { error: "#DIV/0!" });
});

test("SUM adds mixed ranges and scalars", () => {
  const out = compute({ A1: 1, A2: 2, B1: "=SUM(A1:A2, 10)" });
  assert.equal(out.B1, 13);
});

test("SUM of no arguments is 0", () => {
  const out = compute({ A1: "=SUM()" });
  assert.equal(out.A1, 0);
});

test("SUM adds a rectangular range", () => {
  const out = compute({ A1: 1, B1: 2, A2: 3, B2: 4, C1: "=SUM(A1:B2)" });
  assert.equal(out.C1, 10);
});

test("SUM of a single cell ref reads that cell", () => {
  const out = compute({ A1: 8, B1: "=SUM(A1)" });
  assert.equal(out.B1, 8);
});

test("an unknown function is still #NAME?", () => {
  const out = compute({ A1: "=FOO(1,2)" });
  assert.deepEqual(out.A1, { error: "#NAME?" });
});

test("a 2D range stays #VALUE! as a scalar operand", () => {
  const out = compute({ A1: 1, A2: 2, A3: 3, B1: "=A1:B2+1", C1: "=SUM(A1:A3)" });
  assert.deepEqual(out.B1, { error: "#VALUE!" });
  assert.equal(out.C1, 6);
});

test("SUM adds a tilde union of two ranges", () => {
  const out = compute({ A1: 4, A2: 6, B1: "=SUM(A1:A1~A2:A2)" });
  assert.equal(out.B1, 10);
});

test("a tilde union stays #VALUE! as a scalar", () => {
  const out = compute({ A1: 4, A2: 6, B1: "=A1:A1~A2:A2" });
  assert.deepEqual(out.B1, { error: "#VALUE!" });
});

test("AVERAGE averages a tilde union", () => {
  const out = compute({ A1: 4, A2: 6, B1: "=AVERAGE(A1:A1~A2:A2)" });
  assert.equal(out.B1, 5);
});

test("SUM adds the same cell on every sheet in a span", () => {
  const sheets = computeBook({
    sheets: {
      Sheet1: { A1: "=SUM(Sheet1!A2:Sheet3!A2)", B1: "=SUM(Sheet3!A2:Sheet1!A2)", A2: 1 },
      Mid: { A2: 2 },
      Sheet3: { A2: 4 },
    },
  });
  assert.equal(sheets.Sheet1.A1, 7);
  assert.equal(sheets.Sheet1.B1, 7);
});

test("SUM repeats the rectangle on each sheet of a span", () => {
  const sheets = computeBook({
    sheets: {
      Sheet1: { A1: "=SUM(Sheet1!A2:Sheet2!B2)", A2: 1, B2: 2 },
      Sheet2: { A2: 3, B2: 4 },
    },
  });
  assert.equal(sheets.Sheet1.A1, 10);
});

test("SUM of a sheet-qualified range stays on that sheet", () => {
  const sheets = computeBook({
    sheets: {
      Sheet1: { A1: "=SUM(Sheet2!A1:A2)", A2: 9 },
      Sheet2: { A1: 3, A2: 4 },
    },
  });
  assert.equal(sheets.Sheet1.A1, 7);
  assert.equal(sheets.Sheet1.A2, 9);
});
