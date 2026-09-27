/** A table view's row height, as Obsidian stores it in `views[i].rowHeight`. */
export const ROW_HEIGHTS = ["short", "medium", "tall", "extra"] as const;
export type RowHeight = (typeof ROW_HEIGHTS)[number];

export const ROW_HEIGHT_LABELS: Readonly<Record<RowHeight, string>> = {
  short: "Short",
  medium: "Medium",
  tall: "Tall",
  extra: "Extra tall",
};

/** The row height a stored value means: an absent or unknown value is the native default, short. */
export function readRowHeight(value: unknown): RowHeight {
  return ROW_HEIGHTS.includes(value as RowHeight) ? (value as RowHeight) : "short";
}

/** What to store for a row height: short is the native default, so it is stored as absent. */
export function storedRowHeight(height: RowHeight): Exclude<RowHeight, "short"> | undefined {
  return height === "short" ? undefined : height;
}
