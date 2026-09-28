import { describe, expect, it } from "vitest";

import {
  columnAppearanceColors,
  describeColumnAppearance,
  isDefaultColumnAppearance,
  normalizeColumnAppearance,
  resolveColumnAppearance,
} from "../src";

describe("column appearance", () => {
  it("reads stored appearances leniently", () => {
    expect(normalizeColumnAppearance({ tone: "muted", bold: true })).toEqual({ tone: "muted", bold: true });
    expect(normalizeColumnAppearance({ tone: "custom", color: "d44c47" })).toEqual({
      tone: "custom",
      bold: false,
      color: "#D44C47",
    });
    // A custom tone without a valid colour, an unknown tone, or no object: the default.
    expect(normalizeColumnAppearance({ tone: "custom", color: "red" })).toEqual({ tone: "default", bold: false });
    expect(normalizeColumnAppearance({ tone: "loud" })).toEqual({ tone: "default", bold: false });
    expect(normalizeColumnAppearance(null)).toEqual({ tone: "default", bold: false });
    expect(normalizeColumnAppearance({ align: "center" })).toEqual({ tone: "default", bold: false, align: "center" });
    expect(normalizeColumnAppearance({ align: "middle" })).toEqual({ tone: "default", bold: false });
    // A colour kept on another tone is not read.
    expect(normalizeColumnAppearance({ tone: "faint", color: "#000000" })).toEqual({ tone: "faint", bold: false });
  });

  it("knows the default, and describes an appearance", () => {
    expect(isDefaultColumnAppearance({ tone: "default", bold: false })).toBe(true);
    expect(isDefaultColumnAppearance({ tone: "default", bold: true })).toBe(false);
    expect(describeColumnAppearance({ tone: "muted", bold: true })).toBe("Muted + Bold");
    expect(describeColumnAppearance({ tone: "default", bold: false })).toBe("Default");
    expect(describeColumnAppearance({ tone: "faint", bold: false, align: "center" })).toBe("Faint + Center");
    // An alignment alone is a style of its own.
    expect(isDefaultColumnAppearance({ tone: "default", bold: false, align: "right" })).toBe(false);
  });

  it("lets a view's entry win over the Base's", () => {
    const base = { "note.status": { tone: "muted" }, "note.cost": { bold: true } };
    const view = { "note.status": { tone: "faint" } };
    expect(resolveColumnAppearance("note.status", base, view)).toEqual({
      appearance: { tone: "faint", bold: false },
      scope: "view",
    });
    expect(resolveColumnAppearance("note.cost", base, view).scope).toBe("base");
    expect(resolveColumnAppearance("note.other", base, view)).toEqual({
      appearance: { tone: "default", bold: false },
      scope: null,
    });
  });

  it("gives a custom tone readable colours for light and dark themes", () => {
    const colors = columnAppearanceColors({ tone: "custom", bold: false, color: "#1F1F1F" })!;
    expect(colors.light).toMatch(/^#/);
    // A near-black colour is lightened for dark backgrounds.
    expect(colors.dark).not.toBe(colors.light);
    expect(columnAppearanceColors({ tone: "muted", bold: false })).toBeNull();
  });
});
