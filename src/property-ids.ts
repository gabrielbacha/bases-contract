/** A property's full id: a bare frontmatter key such as `status` is `note.status`. */
export function canonicalPropertyId(property: string): string {
  const trimmed = property.trim();
  return /^(note|file|formula)\./.test(trimmed) ? trimmed : `note.${trimmed}`;
}
