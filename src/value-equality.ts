/** Equality of JSON/YAML values without treating mapping key order as data. */
export function equalValues(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((value, index) => equalValues(value, second[index]))
    );
  }
  if (!first || !second || typeof first !== "object" || typeof second !== "object") return false;
  const left = first as Record<string, unknown>;
  const right = second as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && equalValues(left[key], right[key]))
  );
}
