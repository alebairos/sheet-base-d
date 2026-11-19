import {
  csvToWorkbook,
  emptyWorkbook,
  gridModel,
  sheetToCsv,
  workbookFromJson,
  workbookToJson,
  writeCell,
  type GridModel,
  type Workbook,
} from "./sheet.js";

const ARROWS: Record<string, { col: number; row: number }> = {
  ArrowLeft: { col: -1, row: 0 },
  ArrowRight: { col: 1, row: 0 },
  ArrowUp: { col: 0, row: -1 },
  ArrowDown: { col: 0, row: 1 },
};

const formula = byId("formula", HTMLInputElement);
const errorOut = byId("error", HTMLOutputElement);
const gridEl = byId("grid", HTMLElement);
const sheetSel = byId("sheet", HTMLSelectElement);
const status = byId("status", HTMLElement);
const clip = byId("clip", HTMLElement);
const fileJson = byId("file-json", HTMLInputElement);
const fileCsv = byId("file-csv", HTMLInputElement);

let workbook: Workbook = emptyWorkbook();
let sheet = "Sheet1";
let sel = { col: 0, row: 0 };
let dirty = false;
let fillingSheets = false;

byId("open-json", HTMLButtonElement).addEventListener("click", () => pick(fileJson, "json"));
byId("open-csv", HTMLButtonElement).addEventListener("click", () => pick(fileCsv, "csv"));
byId("save-json", HTMLButtonElement).addEventListener("click", saveJson);
byId("save-csv", HTMLButtonElement).addEventListener("click", saveCsv);

formula.addEventListener("input", () => {
  dirty = true;
  errorOut.textContent = "";
  const selected = gridEl.querySelector(".is-selected");
  if (selected !== null) selected.textContent = formula.value;
});

formula.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    commit();
    sel = { col: sel.col, row: sel.row + 1 };
    render();
    gridEl.focus();
    return;
  }
  if (ev.key === "Escape") {
    ev.preventDefault();
    dirty = false;
    render();
    gridEl.focus();
  }
});

formula.addEventListener("blur", () => {
  if (!dirty) return;
  commit();
  render();
});

sheetSel.addEventListener("change", () => {
  if (fillingSheets) return;
  commit();
  sheet = sheetSel.value;
  sel = { col: 0, row: 0 };
  render();
});

gridEl.addEventListener("keydown", (ev) => {
  if (ev.target !== gridEl) return;
  if (ev.key === "Tab") {
    ev.preventDefault();
    select(sel.col + (ev.shiftKey ? -1 : 1), sel.row);
    return;
  }
  const move = ARROWS[ev.key];
  if (move !== undefined) {
    ev.preventDefault();
    select(sel.col + move.col, sel.row + move.row);
    return;
  }
  if (ev.key === "Enter" || ev.key === "F2") {
    ev.preventDefault();
    editFormula();
    return;
  }
  if (ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
    ev.preventDefault();
    formula.value = ev.key;
    dirty = true;
    errorOut.textContent = "";
    formula.focus();
  }
});

render();

function render(): void {
  const model = gridModel(workbook, sheet, sel);
  sheet = model.sheet;
  sel = model.sel;
  formula.value = model.bar.text;
  errorOut.textContent = model.bar.error ?? "";
  clip.textContent = model.clipped ? "Some cells are outside the visible grid." : "";
  fillSheets(model);
  const table = renderTable(model);
  gridEl.replaceChildren(table);
  table.querySelector(".is-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function renderTable(model: GridModel): HTMLTableElement {
  const table = document.createElement("table");
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "row";
  headRow.append(corner);
  for (const label of model.labels) headRow.append(headerCell(label, "col"));
  const thead = document.createElement("thead");
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  model.cells.forEach((line, r) => {
    const tr = document.createElement("tr");
    tr.append(headerCell(String(r + 1), "row"));
    line.forEach((item, c) => {
      const td = document.createElement("td");
      td.textContent = item.display;
      if (item.display !== "") td.title = item.display;
      if (item.align === "right") td.classList.add("num");
      if (item.error) td.classList.add("is-error");
      if (c === model.sel.col && r === model.sel.row) td.classList.add("is-selected");
      td.addEventListener("mousedown", (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        select(c, r);
      });
      td.addEventListener("dblclick", () => {
        editFormula();
      });
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(thead, tbody);
  return table;
}

function headerCell(text: string, scope: "row" | "col"): HTMLTableCellElement {
  const th = document.createElement("th");
  th.scope = scope;
  th.textContent = text;
  if (scope === "row") th.className = "row";
  return th;
}

function select(col: number, row: number): void {
  commit();
  sel = { col, row };
  render();
  gridEl.focus();
}

function editFormula(): void {
  formula.focus();
  formula.setSelectionRange(formula.value.length, formula.value.length);
}

function commit(): void {
  if (!dirty) return;
  workbook = writeCell(workbook, sheet, sel, formula.value);
  dirty = false;
}

function fillSheets(model: GridModel): void {
  const names = model.sheets;
  const same =
    sheetSel.options.length === names.length &&
    names.every((name, i) => sheetSel.options[i]?.value === name);
  if (same && sheetSel.value === model.sheet) return;
  fillingSheets = true;
  if (!same) {
    sheetSel.replaceChildren(
      ...names.map((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        return opt;
      }),
    );
  }
  sheetSel.value = model.sheet;
  fillingSheets = false;
}

function pick(input: HTMLInputElement, kind: "json" | "csv"): void {
  input.value = "";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      loadText(kind, text, file.name);
    };
    reader.readAsText(file);
  };
  input.click();
}

function loadText(kind: "json" | "csv", text: string, fileName: string): void {
  try {
    const next = kind === "json" ? workbookFromJson(text) : csvToWorkbook(text, "Sheet1");
    dirty = false;
    workbook = next;
    sheet = Object.keys(next.sheets)[0] ?? "Sheet1";
    sel = { col: 0, row: 0 };
    status.textContent = `Opened ${fileName}`;
    render();
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : "Open failed";
  }
}

function saveJson(): void {
  commit();
  render();
  download("workbook.json", workbookToJson(workbook), "application/json");
  status.textContent = "Saved workbook.json";
}

function saveCsv(): void {
  commit();
  render();
  const name = csvFileName(sheet);
  download(name, sheetToCsv(workbook, sheet), "text/csv");
  status.textContent = `Saved ${name}`;
}

function csvFileName(name: string): string {
  const stem = name.replaceAll(/[/\\]/g, "").trim();
  return `${stem === "" ? "sheet" : stem}.csv`;
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function byId<T extends Element>(id: string, kind: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof kind)) throw new Error(`missing #${id}`);
  return node;
}
