# A spreadsheet engine (experiment)

A public demo for an experiment: the same spec built by the same AI harness, once with cooknship and once without.

The only spec is [SPEC.md](SPEC.md).

## Build and test

From a clean clone, run `./test.sh`.

That command installs npm packages when `node_modules` is missing, typechecks with `tsc`, and runs the tests. Node.js 20 or newer is required.

## Open the UI

From the repo root, run `npm run ui`. If `node_modules` is missing, run `./test.sh` once before that. Then open http://127.0.0.1:4173/.

The page has a grid and a formula bar. Click a cell. Edit the formula bar. Press Enter to write the cell and move down. The bar shows the stored formula. It also shows an error code when the engine returns one. The grid shows the calculated value.

**Open JSON** and **Save JSON** use the workbook shape in [SPEC.md](SPEC.md). **Open CSV** and **Save CSV** use the active sheet. Opening a CSV replaces the workbook with one sheet named Sheet1. A formula stays in the file as text that starts with `=`. `./engine` is unchanged.

## CLI

`./engine <file|->` reads workbook JSON from a file, or from stdin when the path is `-`.

Numbers, strings, and booleans pass through. A string that starts with `=` is a formula. Formulas made of literals and the operators `+ - * / ^ & = <> < > <= >=`, unary minus, and `%` are calculated. `=1+2` is 3, `=50%` is 0.5, and `=1/0` is `{"error":"#DIV/0!"}`. Exponentiation follows Calc, so `=2^3^2` is 64 and `=-2^2` is 4. `=SUM(A1:A3)` adds the range. `=AVERAGE(A1:A3)` averages the numbers in that range. `=SUMIF(A1:A3,">1")` sums the cells that match. MIN, MAX, COUNT, COUNTA, ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, ABS, POWER, SQRT, PRODUCT, COUNTIF, AVERAGEIF, MEDIAN, and STDEV are available too. IF, IFERROR, AND, OR, NOT, ISBLANK, ISNUMBER, ISTEXT, and ISERROR are available. `=IF(TRUE,1,1/0)` is 1, and `=IFERROR(1,1/0)` is 1. CONCATENATE, LEFT, RIGHT, MID, LEN, UPPER, LOWER, and TRIM are available. `=TRIM("  a   b  ")` is `a b`. `=LEN("a😀b")` is 3. VLOOKUP, INDEX, and MATCH are available. `=VLOOKUP(4,A1:B3,2,FALSE)` finds an exact match. Leave out the fourth argument for an approximate match. `=MATCH(4,A1:A3,0)` returns the position. `=INDEX(A1:C3,2,1)` returns that cell. An unknown function is `{"error":"#NAME?"}`.

`=A1`, `=$A$1`, `=$A1`, and `=A$1` read A1. `=Sheet2!A1` and `='Sheet Name'!A1` read another sheet. The sheet name match ignores case. A missing sheet is `{"error":"#REF!"}`. An empty cell is blank. Blank is 0 in arithmetic and an empty string in concatenation. A formula that returns blank is stored as 0. A later reference to that formula reads 0.

The engine calculates every formula cell in dependency order and reuses the result. A circular reference is `{"error":"#CIRC!"}`.

A range used as one value follows Calc. `=A1:A1` is that cell. A single column uses the cell on the formula's row, from a formula in another column. A formula in that same column is `{"error":"#VALUE!"}`. A single row uses the cell on the formula's column when that column is inside the range. A range with more than one row and more than one column, such as `=A1:B6`, is `{"error":"#VALUE!"}`.

`./engine <file|-> --cell Sheet1!A1` prints one cell as JSON. Dependencies of that formula are calculated too. A missing cell prints `null`. A missing sheet prints `{"error":"#REF!"}`.

## UI

Run `npm run ui` from the repo root.

Open http://127.0.0.1:4173 .

The page is a grid and a formula bar. Click a cell to select it. The bar shows the stored formula, or the literal when the cell is not a formula. When the value is an error, the error code appears beside the formula.

Type, or press Enter, to edit the selected cell. Enter commits the edit and moves the selection down. Escape cancels the edit.

Open JSON reads a workbook in the form from [SPEC.md](SPEC.md). Save JSON writes that same form. A formula stays text that starts with `=`.

Open CSV replaces the cells on the active sheet. Save CSV writes that sheet. Other sheets stay in the workbook. CSV keeps formulas and literals. An error constant is written as its code, and opening that CSV reads the code as text.

The page calculates formulas with `computeWorkbook` in `src/workbook.ts`. `./engine` is the CLI in the section above.
