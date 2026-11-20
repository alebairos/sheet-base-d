export function formatNumber(n: number): string {
  if (n === 0) return "0";
  const neg = n < 0;
  const abs = Math.abs(n);
  const body = abs >= 1e16 || abs < 1e-14 ? formatSci(abs) : formatFixed(abs);
  return neg ? `-${body}` : body;
}

function formatSci(abs: number): string {
  let exp = Math.floor(Math.log10(abs));
  let mant = abs / 10 ** exp;
  if (mant >= 10) {
    mant /= 10;
    exp += 1;
  } else if (mant < 1) {
    mant *= 10;
    exp -= 1;
  }
  let s = mant.toPrecision(15);
  if (/[eE]/.test(s)) s = String(Number(s));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  const sign = exp < 0 ? "-" : "+";
  const digits = String(Math.abs(exp)).padStart(3, "0");
  return `${s}E${sign}${digits}`;
}

function formatFixed(abs: number): string {
  const s = abs.toPrecision(15);
  if (!/[eE]/.test(s)) {
    if (!s.includes(".")) return s;
    return s.replace(/0+$/, "").replace(/\.$/, "");
  }
  const match = /^(\d(?:\.\d+)?)[eE]([+-]?\d+)$/.exec(s);
  if (match === null) return s;
  const mantissa = match[1];
  const expText = match[2];
  if (mantissa === undefined || expText === undefined) return s;
  const digits = mantissa.replace(".", "");
  const exp = Number(expText);
  if (exp >= 0) {
    const width = exp + 1;
    if (digits.length <= width) return digits.padEnd(width, "0");
    const whole = digits.slice(0, width);
    const frac = digits.slice(width).replace(/0+$/, "");
    return frac.length === 0 ? whole : `${whole}.${frac}`;
  }
  const frac = digits.replace(/0+$/, "");
  return `0.${"0".repeat(-exp - 1)}${frac}`;
}
