import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  csvToWorkbook,
  emptyWorkbook,
  gridModel,
  sheetToCsv,
  workbookFromJson,
  workbookToJson,
  writeCell,
} from "../ui/sheet.ts";

test("JSON save keeps formulas, constants, errors, and every sheet", () => {
  const raw = {
    sheets: {
      Sheet1: { A1: 1, A2: "text", A3: true, A4: false, B1: "=A1+1", C1: { error: "#DIV/0!" } },
      Sheet2: { B2: "=Sheet1!A1" },
    },
  };
  const loaded = workbookFromJson(JSON.stringify(raw));
  assert.deepEqual(JSON.parse(workbookToJson(loaded)), raw);
  const model = gridModel(loaded, "Sheet2", { col: 1, row: 1 });
  assert.equal(model.bar.text, "=Sheet1!A1");
  assert.equal(model.cells[1]?.[1]?.display, "1");
});

test("JSON save keeps text that looks like a number until the cell is edited", () => {
  const raw = { sheets: { Sheet1: { A1: "1" } } };
  const wb = workbookFromJson(JSON.stringify(raw));
  assert.deepEqual(JSON.parse(workbookToJson(wb)), raw);
  const edited = writeCell(wb, "Sheet1", { col: 0, row: 0 }, "1");
  assert.deepEqual(JSON.parse(workbookToJson(edited)), { sheets: { Sheet1: { A1: 1 } } });
  assert.deepEqual(JSON.parse(workbookToJson(wb)), raw);
});

test("an empty edit clears the cell", () => {
  const wb = workbookFromJson('{"sheets":{"Sheet1":{"A1":1}}}');
  const next = writeCell(wb, "Sheet1", { col: 0, row: 0 }, "");
  assert.deepEqual(JSON.parse(workbookToJson(next)), { sheets: { Sheet1: {} } });
});

test("CSV round-trips the active sheet, including commas, quotes, and CRLF", () => {
  const wb = workbookFromJson(
    JSON.stringify({
      sheets: {
        Sheet1: { A1: 1, B1: "=A1+1", C2: 'say "hi"', A3: true, B3: false },
      },
    }),
  );
  const csv = sheetToCsv(wb, "Sheet1");
  const back = csvToWorkbook(csv.replaceAll("\n", "\r\n"), "Sheet1");
  assert.deepEqual(back, wb);
});

test("CSV keeps a formula that contains a comma", () => {
  const wb = workbookFromJson('{"sheets":{"Sheet1":{"A1":"=SUM(A1,A2)"}}}');
  const back = csvToWorkbook(sheetToCsv(wb, "Sheet1"), "Sheet1");
  assert.deepEqual(JSON.parse(workbookToJson(back)), {
    sheets: { Sheet1: { A1: "=SUM(A1,A2)" } },
  });
});

test("workbookFromJson rejects invalid JSON", () => {
  assert.throws(() => workbookFromJson("{"), { message: "invalid JSON" });
});

test("an unclosed CSV quote is rejected", () => {
  assert.throws(() => csvToWorkbook('"hello'), { message: "invalid CSV" });
});

test("the formula bar shows the formula and the engine error", () => {
  const wb = workbookFromJson('{"sheets":{"Sheet1":{"A1":"=1/0"}}}');
  const model = gridModel(wb, "Sheet1", { col: 0, row: 0 });
  assert.equal(model.bar.text, "=1/0");
  assert.equal(model.bar.error, "#DIV/0!");
  assert.equal(model.cells[0]?.[0]?.display, "#DIV/0!");
  assert.equal(model.cells[0]?.[0]?.error, true);
});

test("editing a cell recomputes through the engine", () => {
  const wb = workbookFromJson('{"sheets":{"Sheet1":{"A1":1,"B1":"=A1+1"}}}');
  const next = writeCell(wb, "Sheet1", { col: 0, row: 0 }, "4");
  const model = gridModel(next, "Sheet1", { col: 1, row: 0 });
  assert.equal(model.bar.text, "=A1+1");
  assert.equal(model.bar.error, null);
  assert.equal(model.cells[0]?.[1]?.display, "5");
});

test("the grid shows 64 for =2^3^2", () => {
  const wb = workbookFromJson('{"sheets":{"Sheet1":{"A1":"=2^3^2"}}}');
  const model = gridModel(wb, "Sheet1", { col: 0, row: 0 });
  assert.equal(model.bar.text, "=2^3^2");
  assert.equal(model.cells[0]?.[0]?.display, "64");
});

test("column headers use spreadsheet letters past Z", () => {
  const wb = workbookFromJson('{"sheets":{"Sheet1":{"AA1":1}}}');
  const model = gridModel(wb, "Sheet1", { col: 0, row: 0 });
  assert.equal(model.labels[0], "A");
  assert.equal(model.labels[26], "AA");
  assert.equal(model.cells[0]?.[26]?.display, "1");
});

test("selection stays inside the grid", () => {
  const model = gridModel(emptyWorkbook(), "Sheet1", { col: -5, row: -3 });
  assert.deepEqual(model.sel, { col: 0, row: 0 });
});

test("the UI page exists and the grid script imports the engine", () => {
  const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("../ui/main.ts", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("../ui/sheet.ts", import.meta.url), "utf8");
  assert.match(html, /\/dist\/ui\/main\.js/);
  assert.match(html, /id="formula"/);
  assert.match(html, /id="grid"/);
  assert.match(main, /from ["']\.\/sheet\.js["']/);
  assert.match(sheet, /computeWorkbook/);
  assert.match(sheet, /from ["']\.\.\/src\/workbook\.js["']/);
});
