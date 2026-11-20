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
  | { kind: "name" }
  | { kind: "intersect"; left: Expr; right: Expr }
  | { kind: "union"; left: Expr; right: Expr };

type Tok =
  | { k: "num"; n: number }
  | { k: "str"; s: string }
  | { k: "id"; name: string }
  | { k: "ref"; absCol: boolean; absRow: boolean; col: number; row: number }
  | { k: "col"; col: number }
  | { k: "row"; row: number }
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
    if (c === "$" || isLetter(c) || c === "_") {
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
    const leadDot = this.ch() === ".";
    let sawDot = leadDot;
    if (leadDot) {
      this.i++;
      if (!isDigit(this.ch())) this.fail();
      while (isDigit(this.ch())) this.i++;
    } else {
      while (isDigit(this.ch())) this.i++;
      if (this.ch() === ".") {
        this.i++;
        sawDot = true;
        while (isDigit(this.ch())) this.i++;
      }
    }
    let signedExp = false;
    let sawExp = false;
    if (this.ch() === "e" || this.ch() === "E") {
      let j = this.i + 1;
      const sign = this.src[j] ?? "";
      const signed = sign === "+" || sign === "-";
      if (signed) j++;
      if (isDigit(this.src[j] ?? "")) {
        signedExp = signed;
        sawExp = true;
        this.i = j;
        while (isDigit(this.ch())) this.i++;
      }
    }
    // Calc treats 1.2a as a name. A signed exponent, as in 1e+2a, stays a number plus a stray letter.
    if (!leadDot && !signedExp && (isLetter(this.ch()) || this.ch() === "_")) {
      while (isNameChar(this.ch())) this.i++;
      this.tok = { k: "id", name: this.src.slice(start, this.i) };
      return;
    }
    // 1e2.3 is a name. 1e2.3.4 is that name beside .4. A decimal before the exponent, as in 1.2e3.4, does not glue.
    if (sawExp && !sawDot && this.ch() === "." && isExpDotSuffix(this.src[this.i + 1] ?? "")) {
      this.i++;
      while (isExpDotSuffix(this.ch())) this.i++;
      this.tok = { k: "id", name: this.src.slice(start, this.i) };
      return;
    }
    // .5.5 and .5. and .5e2.3 are names. .5.5.5 stays the number .5 beside the name .5.5.
    if (leadDot && this.ch() === ".") {
      const end = dotNameTail(this.src, this.i);
      if (end !== null) {
        this.i = end;
        this.tok = { k: "id", name: this.src.slice(start, this.i) };
        return;
      }
    }
    // 1e2. is 100. Number() rejects the trailing dot, so the value omits it.
    let end = this.i;
    if (sawExp && !sawDot && this.ch() === ".") {
      this.i++;
      end = this.i - 1;
    }
    const text = this.src.slice(start, end);
    let n = Number(text);
    // Calc rejects a literal that flushes to 0. A zero significand, such as 0E-400, stays 0.
    const expAt = text.search(/[eE]/);
    const mag = expAt < 0 ? text : text.slice(0, expAt);
    if (n === 0 && /[1-9]/.test(mag)) n = Number.NaN;
    this.tok = { k: "num", n };
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
      if (isDigit(this.ch())) {
        const digits = this.readDigits();
        if (digits === null) this.fail();
        this.tok = { k: "row", row: rowIndex(digits) };
        return;
      }
      const letters = this.readLetters();
      if (letters === null) this.fail();
      if (this.ch() !== "$" && !isDigit(this.ch())) {
        this.tok = { k: "col", col: colIndex(letters) };
        return;
      }
      const absRow = this.ch() === "$";
      if (absRow) this.i++;
      const digits = this.readDigits();
      if (digits === null) this.fail();
      this.emitRef(true, absRow, letters, digits);
      return;
    }
    const start = this.i;
    const letters = this.readLetters();
    if (letters === null) {
      if (this.ch() !== "_") this.fail();
      while (isNameChar(this.ch())) this.i++;
      this.tok = { k: "id", name: this.src.slice(start, this.i) };
      return;
    }
    if (this.ch() === "$" || isDigit(this.ch())) {
      const absRow = this.ch() === "$";
      if (absRow) this.i++;
      const digits = this.readDigits();
      if (digits === null) this.fail();
      const next = this.peekNonSpace();
      if (!absRow && (next === "(" || (next === "!" && cellAddr(letters, digits) === null))) {
        this.tok = { k: "id", name: letters + digits };
        return;
      }
      // A1B is a name. A valid address with nothing name-like after it stays a cell.
      if (!absRow && isNameChar(this.ch()) && cellAddr(letters, digits) !== null) {
        while (isNameChar(this.ch())) this.i++;
        this.tok = { k: "id", name: this.src.slice(start, this.i) };
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
    const addr = cellAddr(letters, digits);
    if (addr === null) throw new NameFail();
    this.tok = { k: "ref", absCol, absRow, col: addr.col, row: addr.row };
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
      tok.k === "col" ||
      tok.k === "row" ||
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
      if (isRowNum(tok.n) && this.peekNonSpace() === ":") {
        const row = tok.n - 1;
        this.bump();
        return this.unionMore(this.intersectMore(this.finishRowRange(null, row)));
      }
      this.bump();
      return { kind: "number", n: tok.n };
    }
    if (tok.k === "row") {
      const row = tok.row;
      this.bump();
      const expr =
        this.tok.k === ":" ? this.finishRowRange(null, row) : this.rowSpan(null, row, row);
      return this.unionMore(this.intersectMore(expr));
    }
    if (tok.k === "col") {
      const col = tok.col;
      this.bump();
      const expr =
        this.tok.k === ":" ? this.finishColRange(null, col) : this.colSpan(null, col, col);
      return this.unionMore(this.intersectMore(expr));
    }
    if (tok.k === "str") {
      this.bump();
      return { kind: "text", t: tok.s };
    }
    if (tok.k === "(") return this.unionMore(this.intersectMore(this.parseParen()));
    if (tok.k === "qsheet") {
      this.bump();
      return this.unionMore(this.parseAnchoredRef(tok.name));
    }
    if (tok.k === "id") {
      const name = tok.name;
      if (isColName(name) && this.peekNonSpace() === ":") {
        const col = colIndex(name);
        this.bump();
        return this.unionMore(this.intersectMore(this.finishColRange(null, col)));
      }
      this.bump();
      if (this.tok.k === "(") return this.parseCall(name);
      if (this.tok.k === "!") return this.unionMore(this.parseAnchoredRef(name));
      const upper = name.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") return { kind: "bool", b: upper === "TRUE" };
      // Hello, 1.2a, and .5.5 are names. The operator after one is parsed, so a missing operand is Err:520.
      return { kind: "name" };
    }
    if (tok.k === "ref") {
      const cell = this.cellFrom(tok, null);
      this.bump();
      return this.unionMore(this.maybeRange(cell));
    }
    this.fail();
  }

  private parseParen(): Expr {
    this.expect("(");
    const expr = this.parseComp();
    this.expect(")");
    return expr;
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
    const tok = this.tok;
    if (tok.k === "col") {
      this.bump();
      const expr = this.tok.k === ":" ? this.finishColRange(sheet, tok.col) : this.colSpan(sheet, tok.col, tok.col);
      return this.intersectMore(expr);
    }
    if (tok.k === "row") {
      this.bump();
      const expr = this.tok.k === ":" ? this.finishRowRange(sheet, tok.row) : this.rowSpan(sheet, tok.row, tok.row);
      return this.intersectMore(expr);
    }
    if (tok.k === "id" && isColName(tok.name) && this.peekNonSpace() === ":") {
      const col = colIndex(tok.name);
      this.bump();
      return this.intersectMore(this.finishColRange(sheet, col));
    }
    if (tok.k === "num" && isRowNum(tok.n) && this.peekNonSpace() === ":") {
      const row = tok.n - 1;
      this.bump();
      return this.intersectMore(this.finishRowRange(sheet, row));
    }
    if (this.tok.k !== "ref") return this.brokenName();
    const start = this.takeRef(sheet);
    return this.maybeRange(start);
  }

  // Sheet!Hello, Sheet!, and Sheet!1 are names. They error when evaluated.
  private brokenName(): Expr {
    const head = (this.tok as Tok).k;
    if (head === "id" || head === "num") {
      this.bump();
      const next = (this.tok as Tok).k;
      if (next === ":") {
        this.bump();
        this.parseRangeEnd();
      }
      return { kind: "name" };
    }
    if (
      this.tok.k === "eof" ||
      this.tok.k === ")" ||
      this.tok.k === "," ||
      this.tok.k === "~" ||
      this.tok.k === "pct" ||
      this.tok.k === "op"
    ) {
      return { kind: "name" };
    }
    this.fail();
  }

  private maybeRange(start: CellRef): Expr {
    if (this.tok.k !== ":") return this.intersectMore({ kind: "ref", cell: start });
    this.bump();
    const end = this.parseRangeEnd();
    if (end === "name") return { kind: "name" };
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
    if (this.tok.k === "(") return this.intersectMore(this.parseParen());
    const tok = this.tok;
    if (tok.k === "qsheet") {
      this.bump();
      return this.parseAnchoredRef(tok.name);
    }
    if (tok.k === "col") {
      this.bump();
      const expr = this.tok.k === ":" ? this.finishColRange(null, tok.col) : this.colSpan(null, tok.col, tok.col);
      return this.intersectMore(expr);
    }
    if (tok.k === "row") {
      this.bump();
      const expr = this.tok.k === ":" ? this.finishRowRange(null, tok.row) : this.rowSpan(null, tok.row, tok.row);
      return this.intersectMore(expr);
    }
    if (tok.k === "num" && isRowNum(tok.n) && this.peekNonSpace() === ":") {
      const row = tok.n - 1;
      this.bump();
      return this.intersectMore(this.finishRowRange(null, row));
    }
    if (tok.k === "id") {
      const name = tok.name;
      if (isColName(name) && this.peekNonSpace() === ":") {
        const col = colIndex(name);
        this.bump();
        return this.intersectMore(this.finishColRange(null, col));
      }
      this.bump();
      if (this.tok.k === "!") return this.parseAnchoredRef(name);
      throw new NameFail();
    }
    if (tok.k === "ref") {
      const cell = this.cellFrom(tok, null);
      this.bump();
      return this.maybeRange(cell);
    }
    this.fail();
  }

  private parseRangeEnd(): CellRef | "name" {
    const kind = (this.tok as Tok).k;
    if (kind === "qsheet" && this.tok.k === "qsheet") {
      const name = this.tok.name;
      this.bump();
      this.expect("!");
      const cellKind = (this.tok as Tok).k;
      if (cellKind !== "ref") {
        if (cellKind === "id" || cellKind === "num") this.bump();
        else this.fail();
        return "name";
      }
      return this.takeRef(name);
    }
    if (kind === "id" && this.tok.k === "id") {
      const name = this.tok.name;
      const cell = this.bareCell(name);
      this.bump();
      const after = (this.tok as Tok).k;
      if (cell !== null && after === "!") return cell;
      if (after !== "!") return "name";
      this.bump();
      const tail = (this.tok as Tok).k;
      if (tail !== "ref") {
        if (tail === "id" || tail === "num") this.bump();
        else this.fail();
        return "name";
      }
      return this.takeRef(name);
    }
    return this.takeRef(null);
  }

  private bareCell(name: string): CellRef | null {
    const match = /^([A-Za-z]{1,3})(\d+)$/.exec(name);
    if (match === null) return null;
    const letters = match[1];
    const digits = match[2];
    if (letters === undefined || digits === undefined) return null;
    const addr = cellAddr(letters, digits);
    if (addr === null) return null;
    return { sheet: null, col: addr.col, row: addr.row, absCol: false, absRow: false };
  }

  private takeRef(sheet: string | null): CellRef {
    const tok = this.tok;
    if (tok.k !== "ref") this.fail();
    this.bump();
    return this.cellFrom(tok, sheet);
  }

  private finishColRange(sheet: string | null, col: number): Expr {
    if (this.tok.k !== ":") this.fail();
    this.bump();
    return this.colSpan(sheet, col, this.takeCol());
  }

  private finishRowRange(sheet: string | null, row: number): Expr {
    if (this.tok.k !== ":") this.fail();
    this.bump();
    return this.rowSpan(sheet, row, this.takeRow());
  }

  private takeCol(): number {
    const tok = this.tok;
    if (tok.k === "col") {
      this.bump();
      return tok.col;
    }
    if (tok.k === "id" && isColName(tok.name)) {
      const col = colIndex(tok.name);
      this.bump();
      return col;
    }
    throw new NameFail();
  }

  private takeRow(): number {
    const tok = this.tok;
    if (tok.k === "row") {
      this.bump();
      return tok.row;
    }
    if (tok.k === "num" && isRowNum(tok.n)) {
      this.bump();
      return tok.n - 1;
    }
    throw new NameFail();
  }

  // A whole column is every row. A whole row is every column. Callers keep using a rectangle.
  private colSpan(sheet: string | null, col0: number, col1: number): Expr {
    return {
      kind: "range",
      start: { sheet, col: col0, row: 0, absCol: false, absRow: false },
      end: { sheet, col: col1, row: MAX_ROW - 1, absCol: false, absRow: false },
    };
  }

  private rowSpan(sheet: string | null, row0: number, row1: number): Expr {
    return {
      kind: "range",
      start: { sheet, col: 0, row: row0, absCol: false, absRow: false },
      end: { sheet, col: MAX_COL, row: row1, absCol: false, absRow: false },
    };
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
    // Calc supplies missing closing parentheses when the expression is already complete.
    if (k === ")" && this.tok.k === "eof") return;
    if (this.tok.k !== k) this.fail();
    this.bump();
  }
}

const MAX_COL = 16383;
const MAX_ROW = 1048576;

function isColName(name: string): boolean {
  return /^[A-Za-z]{1,3}$/.test(name);
}

function isRowNum(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_ROW;
}

function colIndex(letters: string): number {
  const col = columnIndex(letters);
  if (col === null || col > MAX_COL) throw new NameFail();
  return col;
}

function rowIndex(digits: string): number {
  const row = Number(digits);
  if (!Number.isSafeInteger(row) || row < 1 || row > MAX_ROW) throw new NameFail();
  return row - 1;
}

function cellAddr(letters: string, digits: string): { col: number; row: number } | null {
  const col = columnIndex(letters);
  const row = Number(digits);
  if (col === null || col > MAX_COL || !Number.isSafeInteger(row) || row < 1 || row > MAX_ROW) {
    return null;
  }
  return { col, row: row - 1 };
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

function isExpDotSuffix(c: string): boolean {
  return isNameChar(c) && c !== ".";
}

// The tail of a leading-dot name: ".5" or a final ".". A further dot or a letter keeps the split.
function dotNameTail(src: string, i: number): number | null {
  const n = src[i + 1] ?? "";
  if (n === "." || isLetter(n) || n === "_") return null;
  if (!isDigit(n)) return i + 1;
  let j = i + 1;
  while (isDigit(src[j] ?? "")) j++;
  const after = src[j] ?? "";
  if (after === "." || isLetter(after) || after === "_") return null;
  return j;
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
