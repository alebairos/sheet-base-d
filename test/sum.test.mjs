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

test("SUM skips text literals", () => {
  const out = compute({ A1: '=SUM(1,"x",2)' });
  assert.equal(out.A1, 3);
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
  const out = compute({ A1: "=IF(1,2)" });
  assert.deepEqual(out.A1, { error: "#NAME?" });
});

test("a 2D range stays #VALUE! as a scalar operand", () => {
  const out = compute({ A1: 1, A2: 2, A3: 3, B1: "=A1:B2+1", C1: "=SUM(A1:A3)" });
  assert.deepEqual(out.B1, { error: "#VALUE!" });
  assert.equal(out.C1, 6);
});
