# A spreadsheet engine (experiment)

A public demo for an experiment: the same spec built by the same AI harness, once with cooknship and once without.

The only spec is [SPEC.md](SPEC.md).

## Build and test

From a clean clone, run `./test.sh`.

That command installs npm packages when `node_modules` is missing, typechecks with `tsc`, and runs the tests. Node.js 20 or newer is required.

## CLI

`./engine <file|->` reads workbook JSON from a file, or from stdin when the path is `-`.

Numbers, strings, and booleans pass through. A string that starts with `=` is a formula. Formulas made of literals and the operators `+ - * / ^ & = <> < > <= >=`, unary minus, and `%` are calculated. `=1+2` is 3, `=50%` is 0.5, and `=1/0` is `{"error":"#DIV/0!"}`. Exponentiation follows Calc, so `=2^3^2` is 64 and `=-2^2` is 4. `=SUM(A1:A3)` adds the range. An unknown function is `{"error":"#NAME?"}`.

`=A1`, `=$A$1`, `=$A1`, and `=A$1` read A1. `=Sheet2!A1` and `='Sheet Name'!A1` read another sheet. The sheet name match ignores case. A missing sheet is `{"error":"#REF!"}`. An empty cell is blank. Blank is 0 in arithmetic and an empty string in concatenation. A formula that returns blank is stored as 0. A later reference to that formula reads 0.

The engine calculates every formula cell in dependency order and reuses the result. A circular reference is `{"error":"#CIRC!"}`.

A range used as one value follows Calc. `=A1:A1` is that cell. A single column uses the cell on the formula's row, from a formula in another column. A formula in that same column is `{"error":"#VALUE!"}`. A single row uses the cell on the formula's column when that column is inside the range. A range with more than one row and more than one column, such as `=A1:B6`, is `{"error":"#VALUE!"}`.

`./engine <file|-> --cell Sheet1!A1` prints one cell as JSON. Dependencies of that formula are calculated too. A missing cell prints `null`. A missing sheet prints `{"error":"#REF!"}`.
