const collator = new Intl.Collator("en-US", { sensitivity: "variant" });

// Collation ties é with e plus a combining acute. Only identical strings are equal.
export function textOrder(left: string, right: string): -1 | 0 | 1 {
  if (left === right) return 0;
  const rank = collator.compare(left, right);
  if (rank < 0) return -1;
  if (rank > 0) return 1;
  return left < right ? -1 : 1;
}
