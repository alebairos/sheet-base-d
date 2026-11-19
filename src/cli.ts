import { readFileSync } from "node:fs";
import { parseCellSelector } from "./addr.js";
import { encodeCell } from "./value.js";
import {
  computeWorkbook,
  encodeWorkbook,
  lookupCell,
  parseWorkbook,
  type Workbook,
} from "./workbook.js";

type Args = { file: string; cell: string | null };

function parseArgs(argv: readonly string[]): Args {
  const file = argv[0];
  if (file === undefined || file === "") {
    throw new Error("usage: engine <file|-> [--cell Sheet!A1]");
  }
  let cell: string | null = null;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    if (arg === "--cell") {
      const ref = argv[i + 1];
      if (ref === undefined) throw new Error("usage: engine <file|-> [--cell Sheet!A1]");
      cell = ref;
      i++;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { file, cell };
}

function readWorkbook(file: string): Workbook {
  const text = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("invalid JSON");
  }
  return parseWorkbook(raw);
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    const wb = readWorkbook(args.file);
    if (args.cell !== null) {
      const value = lookupCell(wb, parseCellSelector(args.cell));
      process.stdout.write(`${JSON.stringify(encodeCell(value))}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(encodeWorkbook(computeWorkbook(wb)))}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

main();
