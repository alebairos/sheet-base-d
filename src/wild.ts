export function hasWild(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "~") {
      i += 1;
      continue;
    }
    if (c === "*" || c === "?") return true;
  }
  return false;
}

export function wildRegExp(pat: string): RegExp {
  let src = "^";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i] ?? "";
    if (c === "~") {
      const n = pat[i + 1];
      if (n === "*" || n === "?" || n === "~") {
        src += escapeReg(n);
        i += 1;
        continue;
      }
    }
    if (c === "*") src += "[\\s\\S]*";
    else if (c === "?") src += "[\\s\\S]";
    else src += escapeReg(c);
  }
  return new RegExp(`${src}$`, "i");
}

function escapeReg(c: string): string {
  if ("\\^$+?.()|[]{}".includes(c)) return `\\${c}`;
  return c;
}
