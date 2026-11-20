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
  return spawnSync(engine, args, { input, encoding: "utf8", timeout: 5000 });
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
        A11: '="A"="A"',
        A12: '="a"<>"A"',
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
        A5: false,
        A6: false,
        A7: true,
        A8: false,
        A9: true,
        A10: false,
        A11: true,
        A12: true,
      },
    },
  });
});

test("text order case-folds, then sorts lowercase before uppercase", () => {
  const input = {
    sheets: {
      Sheet1: {
        A1: '="A"<"a"',
        A2: '="a"<"A"',
        A3: '="B"<"a"',
        A4: '="A"="a"',
      },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: {
      Sheet1: {
        A1: false,
        A2: true,
        A3: false,
        A4: false,
      },
    },
  });
});

test("accented letters sort with their base letter and stay unequal to it", () => {
  const input = {
    sheets: {
      Sheet1: {
        A1: '="é"<"f"',
        A2: '="f"<"é"',
        A3: '="ä"<"b"',
        A4: '="ñ"<"o"',
        A5: '="Á"<"B"',
        A6: '="é"="e"',
        A7: '="e"<"é"',
      },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: {
      Sheet1: {
        A1: true,
        A2: false,
        A3: true,
        A4: true,
        A5: true,
        A6: false,
        A7: true,
      },
    },
  });
});

test("an unclosed string or a bare hash is #NAME?", () => {
  const input = {
    sheets: {
      Sheet1: {
        A1: '="abc',
        A2: "=1#2",
        A3: "=1+",
        A4: "=)",
      },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: {
      Sheet1: {
        A1: { error: "#NAME?" },
        A2: { error: "#NAME?" },
        A3: { error: "#N/A" },
        A4: { error: "#VALUE!" },
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
        A9: "=FOO(1,2)",
        A10: "=A1",
        A11: "=$A$1",
        A12: "=Sheet2!B2",
        A13: "=A1:B6",
        A14: "=1+",
        A15: '="say ""hi"""',
        A16: "=1+A1",
        A17: "=FOO(1/0)",
        A18: "=1+2)",
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
        A10: 5,
        A11: 5,
        A12: { error: "#REF!" },
        A13: { error: "#VALUE!" },
        A14: { error: "#N/A" },
        A15: 'say "hi"',
        A16: 6,
        A17: { error: "#NAME?" },
        A18: { error: "#VALUE!" },
      },
    },
  });
});

test("a reference reads the referenced cell", () => {
  const res = run(["-"], '{"sheets":{"Sheet1":{"A1":10,"B1":"=A1"}}}');
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: { Sheet1: { A1: 10, B1: 10 } },
  });
});

test("a chain calculates in dependency order", () => {
  const input = { sheets: { Sheet1: { C1: "=B1+1", B1: "=A1*2", A1: 10 } } };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: { Sheet1: { C1: 21, B1: 20, A1: 10 } },
  });
});

test("cross-sheet references and a self-reference", () => {
  const input = {
    sheets: {
      Sheet1: { A1: 10, B1: "=A1*2", C1: "=Sheet2!A1+B1" },
      Sheet2: { A1: 5, B1: "=B1" },
    },
  };
  const res = spawnSync(engine, ["-"], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 2000,
  });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: {
      Sheet1: { A1: 10, B1: 20, C1: 25 },
      Sheet2: { A1: 5, B1: { error: "#CIRC!" } },
    },
  });
});

test("--cell follows dependencies", () => {
  const input = {
    sheets: {
      Sheet1: { A1: 10, B1: "=A1*2", C1: "=Sheet2!A1+B1" },
      Sheet2: { A1: 5 },
    },
  };
  const res = run(["-", "--cell", "Sheet1!C1"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "25\n");
});

test("a blank reference is 0 in arithmetic and empty in concatenation", () => {
  const input = {
    sheets: {
      Sheet1: { B1: "=A1+1", C1: "=A1", D1: '=A1&"x"', E1: '=C1&"x"' },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: { Sheet1: { B1: 1, C1: 0, D1: "x", E1: "0x" } },
  });
});

test("a blank cell equals an empty string and equals zero", () => {
  const input = {
    sheets: {
      Sheet1: {
        A1: '=B1=""',
        A2: '=B1<>""',
        A3: "=B1=0",
        A4: '=""=B1',
        A5: '="x"=B1',
      },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: { Sheet1: { A1: true, A2: false, A3: true, A4: true, A5: false } },
  });
});

test("a mutual cycle returns #CIRC! and finishes", { timeout: 2000 }, () => {
  const input = { sheets: { Sheet1: { A1: "=B1", B1: "=A1" } } };
  const res = spawnSync(engine, ["-"], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 2000,
  });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: {
      Sheet1: { A1: { error: "#CIRC!" }, B1: { error: "#CIRC!" } },
    },
  });
});

test("absolute references read the same cell", () => {
  const input = {
    sheets: { Sheet1: { A1: 4, B1: "=$A$1", C1: "=A$1", D1: "=$A1" } },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: { Sheet1: { A1: 4, B1: 4, C1: 4, D1: 4 } },
  });
});

test("quoted and case-insensitive sheet names resolve", () => {
  const input = {
    sheets: {
      "Sheet Name": { A1: 3 },
      Sheet1: { A1: "='Sheet Name'!A1", B1: "=sheet1!A1" },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: {
      "Sheet Name": { A1: 3 },
      Sheet1: { A1: 3, B1: 3 },
    },
  });
});

test("! between two ranges returns their overlap", () => {
  const input = {
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
        D2: "=A1:C3!B1:B3",
        E2: "=A1:C3!B1:C2",
        F1: "=A1:A1!C3",
        G1: "=Sheet2!A1",
      },
      Sheet2: { A1: 9 },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  const sheet = JSON.parse(res.stdout).sheets.Sheet1;
  assert.equal(sheet.A4, 5);
  assert.equal(sheet.D2, 5);
  assert.deepEqual(sheet.E2, { error: "#VALUE!" });
  assert.deepEqual(sheet.F1, { error: "#NULL!" });
  assert.equal(sheet.G1, 9);
});

test("range!cell returns the overlap", () => {
  const input = {
    sheets: {
      Sheet1: {
        A1: 1,
        B1: 2,
        C1: 3,
        A2: 4,
        B2: 5,
        C2: 6,
        A3: "=A1:C2!B2",
        D1: "=Sheet2!A1",
      },
      Sheet2: { A1: 8 },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  const sheet = JSON.parse(res.stdout).sheets.Sheet1;
  assert.equal(sheet.A3, 5);
  assert.equal(sheet.D1, 8);
});

test("ranges used as values follow Calc", () => {
  const input = {
    sheets: {
      Col: { A1: 10, A2: 20, A3: 30, C1: "=A1:A3", C2: "=A1:A3+1", C4: "=A1:A3" },
      SelfCol: { A1: 10, A2: "=A1:A3", A3: 30 },
      Row: { A1: 10, B1: 20, C1: 30, D1: "=A1:C1", B2: "=A1:C1" },
      RowSelf: { A1: 10, B1: "=A1:C1", C1: 30 },
      Area: { A1: "=A1:B6", B2: "=Z1:Z1" },
      Cross: { A1: "=Sheet2!A1:A1", B1: "=Other!A1", C1: "=Col!A1:Sheet2!A1" },
      Sheet2: { A1: 5 },
    },
  };
  const res = run(["-"], JSON.stringify(input));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    sheets: {
      Col: { A1: 10, A2: 20, A3: 30, C1: 10, C2: 21, C4: { error: "#VALUE!" } },
      SelfCol: { A1: 10, A2: { error: "#VALUE!" }, A3: 30 },
      Row: { A1: 10, B1: 20, C1: 30, D1: { error: "#VALUE!" }, B2: 20 },
      RowSelf: { A1: 10, B1: { error: "#CIRC!" }, C1: 30 },
      Area: { A1: { error: "#VALUE!" }, B2: 0 },
      Cross: { A1: 5, B1: { error: "#REF!" }, C1: 5 },
      Sheet2: { A1: 5 },
    },
  });
});

test("a bang intersection with no shared sheet is #NULL!", () => {
  const res = run(
    ["-"],
    JSON.stringify({
      sheets: {
        Sheet1: { A1: 1, B2: 5, D1: "=Sheet1!A1:C3!Sheet2!B2" },
        Sheet2: { B2: 50 },
      },
    }),
  );
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).sheets.Sheet1.D1, { error: "#NULL!" });
});

test("a space intersection with no shared sheet is #NULL!", () => {
  const res = run(
    ["-"],
    JSON.stringify({
      sheets: {
        Sheet1: { A1: 1, B2: 5, D1: "=A1:C3 Sheet2!B2" },
        Sheet2: { B2: 50 },
      },
    }),
  );
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).sheets.Sheet1.D1, { error: "#NULL!" });
});

test("an empty cross-sheet intersection is #NULL!", () => {
  const res = run(
    ["-"],
    JSON.stringify({
      sheets: {
        Sheet1: { A1: "=Sheet1!A1:A2!Sheet2!C1:C2" },
        Sheet2: { C1: 9 },
      },
    }),
  );
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).sheets.Sheet1.A1, { error: "#NULL!" });
});

test("a sheet span intersected with the formula sheet cell keeps that cell", () => {
  const res = run(
    ["-"],
    JSON.stringify({
      sheets: {
        Sheet1: { A1: 3, B1: "=Sheet1!A1:Sheet2!A1 Sheet1!A1" },
        Sheet2: { A1: 4 },
      },
    }),
  );
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).sheets.Sheet1.B1, 3);
});

test("a sheet span intersected with the other sheet cell keeps that cell", () => {
  const res = run(
    ["-"],
    JSON.stringify({
      sheets: {
        Sheet1: { A1: 3, B1: "=Sheet1!A1:Sheet2!A1 Sheet2!A1" },
        Sheet2: { A1: 4 },
      },
    }),
  );
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).sheets.Sheet1.B1, 4);
});

test("SUM of a sheet span intersected with itself adds every shared sheet", () => {
  const res = run(
    ["-"],
    JSON.stringify({
      sheets: {
        Sheet1: { A1: 3, B1: "=SUM(Sheet1!A1:Sheet2!A1 Sheet1!A1:Sheet2!A1)" },
        Sheet2: { A1: 4 },
      },
    }),
  );
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).sheets.Sheet1.B1, 7);
});
