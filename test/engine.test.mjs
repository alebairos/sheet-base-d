import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const engine = fileURLToPath(new URL("../engine", import.meta.url));

const formulaBook = '{"sheets":{"Sheet1":{"A1":1,"B1":"=1+1"}}}';
const formulaOut = '{"sheets":{"Sheet1":{"A1":1,"B1":2}}}\n';

function run(args, input) {
  return spawnSync(engine, args, { input, encoding: "utf8" });
}

test("stdin JSON calculates a literal formula", () => {
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

test("--cell on a formula prints the calculated value", () => {
  const res = run(["-", "--cell", "Sheet1!B1"], formulaBook);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "2\n");
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

test("literal formulas follow Calc precedence", () => {
  const input = {
    sheets: {
      S: {
        A1: "=1+2",
        A2: "=2^3^2",
        A3: "=-2^2",
        A4: "=1/0",
        A5: "=50%",
        A6: '="a"&"b"',
        A7: "=-(2^2)",
        A8: "=1+2*3",
        A9: "=(1+2)*3",
        A10: "=100*50%",
        A11: "=(1+1)%",
        A12: "=2^-2",
        A13: "=-2^-2",
        A14: "=2^-3^2",
        A15: "=0^0",
        A16: "=(-8)^(1/3)",
        A17: "=(-4)^0.5",
        A18: "=0^-1",
        A19: "=0.1+0.2",
      },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: {
      S: {
        A1: 3,
        A2: 64,
        A3: 4,
        A4: { error: "#DIV/0!" },
        A5: 0.5,
        A6: "ab",
        A7: -4,
        A8: 7,
        A9: 9,
        A10: 50,
        A11: 0.02,
        A12: 0.25,
        A13: 0.25,
        A14: 0.015625,
        A15: 1,
        A16: -2,
        A17: { error: "#NUM!" },
        A18: { error: "#NUM!" },
        A19: 0.3,
      },
    },
  });
});

test("comparisons return booleans", () => {
  const input = {
    sheets: {
      S: {
        A1: "=1=1",
        A2: "=1<>1",
        A3: "=1<2",
        A4: "=2>=2",
        A5: '= "A"="a"',
        A6: '="10">"9"',
        A7: "=1=TRUE",
        A8: '="1"=1',
        A9: '=1&2="12"',
        A10: "=1&2=12",
      },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: {
      S: {
        A1: true,
        A2: false,
        A3: true,
        A4: true,
        A5: true,
        A6: false,
        A7: true,
        A8: false,
        A9: true,
        A10: false,
      },
    },
  });
});

test("coercion, concatenation, references, and unknown functions", () => {
  const input = {
    sheets: {
      S: {
        A1: '="2"+3',
        A2: '="a"+1',
        A3: "=TRUE+1",
        A4: "=FALSE*5",
        A5: "=1&2",
        A6: "=TRUE&FALSE",
        A7: '=(1/3)&""',
        A8: '=1E+20&""',
        A9: "=SUM(1,2)",
        A10: "=A1",
        A11: "=$A$1",
        A12: "=Sheet2!B2",
        A13: "=A1:B6",
        A14: "=1+",
        A15: '="say ""hi"""',
        A16: "=1+A1",
        A17: "=SUM(1/0)",
      },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: {
      S: {
        A1: 5,
        A2: { error: "#VALUE!" },
        A3: 2,
        A4: 0,
        A5: "12",
        A6: "10",
        A7: "0.333333333333333",
        A8: "1E+020",
        A9: { error: "#NAME?" },
        A10: { error: "#REF!" },
        A11: { error: "#REF!" },
        A12: { error: "#REF!" },
        A13: { error: "#REF!" },
        A14: { error: "#VALUE!" },
        A15: 'say "hi"',
        A16: { error: "#REF!" },
        A17: { error: "#NAME?" },
      },
    },
  });
});
