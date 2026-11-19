import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const engine = fileURLToPath(new URL("../engine", import.meta.url));

const formulaBook = '{"sheets":{"Sheet1":{"A1":1,"B1":"=1+1"}}}';
const formulaOut = '{"sheets":{"Sheet1":{"A1":1,"B1":{"error":"#NAME?"}}}}\n';

function run(args, input) {
  return spawnSync(engine, args, { input, encoding: "utf8" });
}

test("stdin JSON replaces a formula with #NAME?", () => {
  const res = run(["-"], formulaBook);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, formulaOut);
});

test("a workbook file produces the same computed JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-"));
  const path = join(dir, "book.json");
  writeFileSync(path, formulaBook);
  const res = run([path]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, formulaOut);
});

test("constant cells round-trip", () => {
  const input = {
    sheets: {
      Sheet1: {
        A1: 0,
        A2: "text",
        A3: true,
        A4: false,
        A5: "",
        A6: "#NAME?",
        B1: { error: "#DIV/0!" },
      },
      Sheet2: {},
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), input);
});

test("--cell prints the number 1", () => {
  const res = run(["-", "--cell", "Sheet1!A1"], formulaBook);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "1\n");
});

test("--cell on a formula prints the error object", () => {
  const res = run(["-", "--cell", "Sheet1!B1"], formulaBook);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '{"error":"#NAME?"}\n');
});

test("--cell on a missing cell prints null", () => {
  const res = run(["-", "--cell", "Sheet1!H1"], formulaBook);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "null\n");
});

test("--cell on a missing sheet prints #REF!", () => {
  const res = run(["-", "--cell", "Missing!A1"], formulaBook);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '{"error":"#REF!"}\n');
});

test("a cell that is not a value exits non-zero", () => {
  const res = run(["-"], '{"sheets":{"Sheet1":{"A1":[]}}}');
  assert.notEqual(res.status, 0);
});
