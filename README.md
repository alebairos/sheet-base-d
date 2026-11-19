# A spreadsheet engine (experiment)

A public demo for an experiment: the same spec built by the same AI harness, once with cooknship and once without.

The only spec is [SPEC.md](SPEC.md).

## Build and test

From a clean clone, run `./test.sh`.

That command installs npm packages when `node_modules` is missing, typechecks with `tsc`, and runs the tests. Node.js 20 or newer is required.

## CLI

`./engine <file|->` reads workbook JSON from a file, or from stdin when the path is `-`.

Numbers, strings, and booleans pass through. A string that starts with `=` is a formula. Each formula is returned as `{"error":"#NAME?"}` because formulas are not calculated in this version.

`./engine <file|-> --cell Sheet1!A1` prints one cell as JSON. A missing cell prints `null`. A missing sheet prints `{"error":"#REF!"}`.
