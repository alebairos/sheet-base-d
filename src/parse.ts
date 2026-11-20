import { columnIndex } from "./addr.js";

export type BinOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "&"
  | "="
  | "<>"
  | "<"
  | ">"
  | "<="
  | ">=";

export type CellRef = {
  sheet: string | null;
  col: number;
  row: number;
  absCol: boolean;
  absRow: boolean;
};

export type Expr =
  | { kind: "number"; n: number }
  | { kind: "text"; t: string }
  | { kind: "bool"; b: boolean }
  | { kind: "blank" }
  | { kind: "unary"; op: "-" | "%"; arg: Expr }
  | { kind: "binary"; op: BinOp; left: Expr; right: Expr }
  | { kind: "call"; name: string; args: Expr[] }
  | { kind: "ref"; cell: CellRef }
  | { kind: "range"; start: CellRef; end: CellRef }
  | { kind: "intersect"; left: Expr; right: Expr }
  | { kind: "union"; left: Expr; right: Expr };

type Tok =
  | { k: "num"; n: number }
  | { k: "str"; s: string }
  | { k: "id"; name: string }
  | { k: "ref"; absCol: boolean; absRow: boolean; col: number; row: number }
  | { k: "qsheet"; name: string }
  | { k: "op"; op: BinOp }
  | { k: "pct" }
  | { k: "(" }
  | { k: ")" }
  | { k: "," }
  | { k: ":" }
  | { k: "!" }
  | { k: "~" }
  | { k: "eof" };

class ParseFail extends Error {}

class TrailingOp extends ParseFail {}

class NameFail extends ParseFail {}

class Parser {
  private readonly src: string;
  private i = 0;
  private tok: Tok = { k: "eof" };
  private spaced = false;

  constructor(src: string) {
    this.src = src;
    this.bump();
  }

  parse(): Expr {
    const expr = this.parseComp();
    if (this.tok.k !== "eof") this.fail();
    return expr;
  }

  private fail(): never {
    throw new ParseFail();
  }

  private ch(): string {
    return this.src[this.i] ?? "";
  }

  private bump(): void {
    this.spaced = false;
    while (isWs(this.ch())) {
      this.spaced = true;
      this.i++;
    }
    const c = this.ch();
    if (c === "") {
      this.tok = { k: "eof" };
      return;
    }
    if (isDigit(c) || (c === "." && isDigit(this.src[this.i + 1] ?? ""))) {
      this.readNumber();
      return;
    }
    if (c === "$" || isLetter(c)) {
      this.readNameOrRef();
      return;
    }
    if (c === '"') {
      this.readQuoted('"', "str");
      return;
    }
    if (c === "'") {
      this.readQuoted("'", "qsheet");
      return;
    }
    this.readOp();
  }

  private readNumber(): void {
    const start = this.i;
    if (this.ch() === ".") {
      this.i++;
      if (!isDigit(this.ch())) this.fail();
      while (isDigit(this.ch())) this.i++;
    } else {
      while (isDigit(this.ch())) this.i++;
      if (this.ch() === ".") {
        this.i++;
        while (isDigit(this.ch())) this.i++;
      }
    }
    if (this.ch() === "e" || this.ch() === "E") {
      let j = this.i + 1;
      const sign = this.src[j] ?? "";
      if (sign === "+" || sign === "-") j++;
      if (isDigit(this.src[j] ?? "")) {
        this.i = j;
        while (isDigit(this.ch())) this.i++;
      }
    }
    this.tok = { k: "num", n: Number(this.src.slice(start, this.i)) };
  }

  private readQuoted(quote: '"' | "'", kind: "str" | "qsheet"): void {
    this.i++;
    let s = "";
    for (;;) {
      const c = this.ch();
      if (c === "") {
        if (quote === '"') throw new NameFail();
        this.fail();
      }
      if (c === quote) {
        this.i++;
        if (this.ch() === quote) {
          s += quote;
          this.i++;
          continue;
        }
        this.tok = kind === "str" ? { k: "str", s } : { k: "qsheet", name: s };
        return;
      }
      s += c;
      this.i++;
    }
  }

  private readNameOrRef(): void {
    if (this.ch() === "$") {
      this.i++;
      const letters = this.readLetters();
      if (letters === null) this.fail();
      const absRow = this.ch() === "$";
      if (absRow) this.i++;
      const digits = this.readDigits();
      if (digits === null) this.fail();
      this.emitRef(true, absRow, letters, digits);
      return;
    }
    const start = this.i;
    const letters = this.readLetters();
    if (letters === null) this.fail();
    if (this.ch() === "$" || isDigit(this.ch())) {
      const absRow = this.ch() === "$";
      if (absRow) this.i++;
      const digits = this.readDigits();
      if (digits === null) this.fail();
      const next = this.peekNonSpace();
      if (!absRow && (next === "(" || next === "!")) {
        this.tok = { k: "id", name: letters + digits };
        return;
      }
      this.emitRef(false, absRow, letters, digits);
      return;
    }
    while (isNameChar(this.ch())) this.i++;
    this.tok = { k: "id", name: this.src.slice(start, this.i) };
  }

  private peekNonSpace(): string {
    let j = this.i;
    while (isWs(this.src[j] ?? "")) j++;
    return this.src[j] ?? "";
  }

  private readLetters(): string | null {
    const start = this.i;
    while (isLetter(this.ch())) this.i++;
    if (this.i === start) return null;
    return this.src.slice(start, this.i);
  }

  private readDigits(): string | null {
    const start = this.i;
    while (isDigit(this.ch())) this.i++;
    if (this.i === start) return null;
    return this.src.slice(start, this.i);
  }

  private emitRef(absCol: boolean, absRow: boolean, letters: string, digits: string): void {
    const col = columnIndex(letters);
    const row = Number(digits);
    if (col === null || !Number.isSafeInteger(row) || row < 1) this.fail();
    this.tok = { k: "ref", absCol, absRow, col, row: row - 1 };
  }

  private readOp(): void {
    const c = this.ch();
    const n = this.src[this.i + 1] ?? "";
    if (c === "<" && n === ">") {
      this.i += 2;
      this.tok = { k: "op", op: "<>" };
      return;
    }
    if (c === "<" && n === "=") {
      this.i += 2;
      this.tok = { k: "op", op: "<=" };
      return;
    }
    if (c === ">" && n === "=") {
      this.i += 2;
      this.tok = { k: "op", op: ">=" };
      return;
    }
    if (c === "#") throw new NameFail();
    this.i++;
    if (c === "%") {
      this.tok = { k: "pct" };
      return;
    }
    if (c === "(" || c === ")" || c === "," || c === ":" || c === "!" || c === "~") {
      this.tok = { k: c };
      return;
    }
    if (
      c === "+" ||
      c === "-" ||
      c === "*" ||
      c === "/" ||
      c === "^" ||
      c === "&" ||
      c === "=" ||
      c === "<" ||
      c === ">"
    ) {
      this.tok = { k: "op", op: c };
      return;
    }
    this.fail();
  }

  private parseComp(): Expr {
    let left = this.parseConcat();
    while (this.tok.k === "op" && isComp(this.tok.op)) {
      const op = this.tok.op;
      this.bump();
      this.requireOperand();
      const right = this.parseConcat();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseConcat(): Expr {
    let left = this.parseAdd();
    while (this.tok.k === "op" && this.tok.op === "&") {
      this.bump();
      this.requireOperand();
      const right = this.parseAdd();
      left = { kind: "binary", op: "&", left, right };
    }
    return left;
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    while (this.tok.k === "op" && (this.tok.op === "+" || this.tok.op === "-")) {
      const op = this.tok.op;
      this.bump();
      this.requireOperand();
      const right = this.parseMul();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMul(): Expr {
    let left = this.parsePow();
    while (this.tok.k === "op" && (this.tok.op === "*" || this.tok.op === "/")) {
      const op = this.tok.op;
      this.bump();
      this.requireOperand();
      const right = this.parsePow();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parsePow(): Expr {
    let left = this.parseUnary();
    while (this.tok.k === "op" && this.tok.op === "^") {
      this.bump();
      this.requireOperand();
      const right = this.parseUnary();
      left = { kind: "binary", op: "^", left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.tok.k === "op" && (this.tok.op === "+" || this.tok.op === "-")) {
      const op = this.tok.op;
      this.bump();
      this.requireOperand();
      const arg = this.parseUnary();
      if (op === "+") return arg;
      return { kind: "unary", op: "-", arg };
    }
    return this.parsePostfix();
  }

  private requireOperand(): void {
    const tok = this.tok;
    if (
      tok.k === "num" ||
      tok.k === "str" ||
      tok.k === "(" ||
      tok.k === "qsheet" ||
      tok.k === "id" ||
      tok.k === "ref" ||
      (tok.k === "op" && (tok.op === "+" || tok.op === "-"))
    ) {
      return;
    }
    throw new TrailingOp();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    while (this.tok.k === "pct") {
      this.bump();
      expr = { kind: "unary", op: "%", arg: expr };
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const tok = this.tok;
    if (tok.k === "num") {
      this.bump();
      return { kind: "number", n: tok.n };
    }
    if (tok.k === "str") {
      this.bump();
      return { kind: "text", t: tok.s };
    }
    if (tok.k === "(") {
      this.bump();
      const expr = this.parseComp();
      this.expect(")");
      return expr;
    }
    if (tok.k === "qsheet") {
      this.bump();
      return this.unionMore(this.parseAnchoredRef(tok.name));
    }
    if (tok.k === "id") {
      const name = tok.name;
      this.bump();
      if (this.tok.k === "(") return this.parseCall(name);
      if (this.tok.k === "!") return this.unionMore(this.parseAnchoredRef(name));
      const upper = name.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") return { kind: "bool", b: upper === "TRUE" };
      this.fail();
    }
    if (tok.k === "ref") {
      const cell = this.cellFrom(tok, null);
      this.bump();
      return this.unionMore(this.maybeRange(cell));
    }
    this.fail();
  }

  private parseCall(name: string): Expr {
    const upper = name.toUpperCase();
    const args = this.parseArgs();
    if ((upper === "TRUE" || upper === "FALSE") && args.length === 0) {
      return { kind: "bool", b: upper === "TRUE" };
    }
    return { kind: "call", name: upper, args };
  }

  private parseArgs(): Expr[] {
    this.expect("(");
    const args: Expr[] = [];
    if (this.token().k === ")") {
      this.bump();
      return args;
    }
    for (;;) {
      const kind = this.token().k;
      if (kind === "," || kind === ")") args.push({ kind: "blank" });
      else args.push(this.parseComp());
      if (this.token().k !== ",") break;
      this.bump();
    }
    this.expect(")");
    return args;
  }

  private token(): Tok {
    return this.tok;
  }

  private parseAnchoredRef(sheet: string): Expr {
    this.expect("!");
    const start = this.takeRef(sheet);
    return this.maybeRange(start);
  }

  private maybeRange(start: CellRef): Expr {
    if (this.tok.k !== ":") return this.intersectMore({ kind: "ref", cell: start });
    this.bump();
    const end = this.parseRangeEnd();
    if (start.sheet !== null && end.sheet === null) end.sheet = start.sheet;
    return this.intersectMore({ kind: "range", start, end });
  }

  private unionMore(left: Expr): Expr {
    if (this.tok.k !== "~") return left;
    this.bump();
    return this.unionMore({ kind: "union", left, right: this.parseIntersectSide() });
  }

  private intersectMore(left: Expr): Expr {
    if (this.tok.k === "!") {
      this.bump();
      return this.intersectMore({ kind: "intersect", left, right: this.parseIntersectSide() });
    }
    if (this.spaced && this.startsIntersect()) {
      return this.intersectMore({ kind: "intersect", left, right: this.parseIntersectSide() });
    }
    return left;
  }

  private startsIntersect(): boolean {
    const k = this.tok.k;
    if (k === "ref") return true;
    if (k === "qsheet" || k === "id") return this.peekNonSpace() === "!";
    return false;
  }

  private parseIntersectSide(): Expr {
    const tok = this.tok;
    if (tok.k === "qsheet") {
      this.bump();
      return this.parseAnchoredRef(tok.name);
    }
    if (tok.k === "id") {
      const name = tok.name;
      this.bump();
      if (this.tok.k === "!") return this.parseAnchoredRef(name);
      this.fail();
    }
    if (tok.k === "ref") {
      const cell = this.cellFrom(tok, null);
      this.bump();
      return this.maybeRange(cell);
    }
    this.fail();
  }

  private parseRangeEnd(): CellRef {
    const tok = this.tok;
    if (tok.k === "qsheet") {
      this.bump();
      this.expect("!");
      return this.takeRef(tok.name);
    }
    if (tok.k === "id") {
      const cell = this.bareCell(tok.name);
      this.bump();
      if (cell !== null && this.tok.k === "!") return cell;
      this.expect("!");
      return this.takeRef(tok.name);
    }
    return this.takeRef(null);
  }

  private bareCell(name: string): CellRef | null {
    const match = /^([A-Za-z]{1,3})(\d+)$/.exec(name);
    if (match === null) return null;
    const letters = match[1];
    const digits = match[2];
    if (letters === undefined || digits === undefined) return null;
    const col = columnIndex(letters);
    const row = Number(digits);
    if (col === null || !Number.isSafeInteger(row) || row < 1) return null;
    return { sheet: null, col, row: row - 1, absCol: false, absRow: false };
  }

  private takeRef(sheet: string | null): CellRef {
    const tok = this.tok;
    if (tok.k !== "ref") this.fail();
    this.bump();
    return this.cellFrom(tok, sheet);
  }

  private cellFrom(tok: Extract<Tok, { k: "ref" }>, sheet: string | null): CellRef {
    return {
      sheet,
      col: tok.col,
      row: tok.row,
      absCol: tok.absCol,
      absRow: tok.absRow,
    };
  }

  private expect(k: "(" | ")" | "!"): void {
    if (this.tok.k !== k) this.fail();
    this.bump();
  }
}

function isComp(op: BinOp): op is "=" | "<>" | "<" | ">" | "<=" | ">=" {
  return op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=";
}

function isWs(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isLetter(c: string): boolean {
  return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");
}

function isNameChar(c: string): boolean {
  return isLetter(c) || isDigit(c) || c === "_" || c === ".";
}

export type ParsedFormula =
  | { kind: "expr"; expr: Expr }
  | { kind: "error"; code: "#VALUE!" | "#N/A" | "#NAME?" };

export function parseFormula(src: string): ParsedFormula {
  if (!src.startsWith("=")) return { kind: "error", code: "#VALUE!" };
  try {
    return { kind: "expr", expr: new Parser(src.slice(1)).parse() };
  } catch (err) {
    if (err instanceof TrailingOp) return { kind: "error", code: "#N/A" };
    if (err instanceof NameFail) return { kind: "error", code: "#NAME?" };
    if (err instanceof ParseFail) return { kind: "error", code: "#VALUE!" };
    throw err;
  }
}
