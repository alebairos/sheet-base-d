const collator = new Intl.Collator("en-US", { sensitivity: "variant" });

// A collator tie is 0 even when the code points differ. Lookup breaks that tie.
export function textCollation(left: string, right: string): -1 | 0 | 1 {
  if (left === right) return 0;
  const rank = collator.compare(left, right);
  if (rank < 0) return -1;
  if (rank > 0) return 1;
  return 0;
}

export function textOrder(left: string, right: string): -1 | 0 | 1 {
  const rank = textCollation(left, right);
  if (rank !== 0) return rank;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
