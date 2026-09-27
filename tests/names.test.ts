import { expect, it } from "vitest";

import { formulaNameFrom, noteNameFrom, propertyKeyFrom, uniqueName } from "../src/names";

it("makes any typed text a portable record name", () => {
  expect(noteNameFrom("Plan: Q3 / Q4?")).toBe("Plan - Q3 - Q4");
  expect(noteNameFrom("  [[Draft]] #1 ^x  ")).toBe("Draft 1 x");
  expect(noteNameFrom("a|b\\c")).toBe("a-b-c");
  expect(noteNameFrom("???")).toBe("Untitled");
  expect(noteNameFrom(".hidden. ")).toBe("hidden");
  expect(noteNameFrom("con")).toBe("con-1");
  expect(noteNameFrom("Report.md")).toBe("Report");
  expect(noteNameFrom("   ")).toBe("Untitled");
  expect(noteNameFrom("...")).toBe("Untitled");
  expect(noteNameFrom("Café")).toBe("Café");
  expect(noteNameFrom("a".repeat(200))).toHaveLength(120);
});

it("numbers a name until it is free", () => {
  const taken = new Set(["task", "task 2"]);
  expect(uniqueName("Task", (name) => taken.has(name.toLowerCase()))).toBe("Task 3");
  expect(uniqueName("Other", (name) => taken.has(name.toLowerCase()))).toBe("Other");
});

it("makes any field name a valid, unused property key", () => {
  expect(propertyKeyFrom("Due date")).toBe("due_date");
  expect(propertyKeyFrom("Été à Paris")).toBe("ete_a_paris");
  expect(propertyKeyFrom("2nd price")).toBe("field_2nd_price");
  expect(propertyKeyFrom("💰")).toBe("field");
  expect(propertyKeyFrom("Price", ["note.price"])).toBe("price_2");
  expect(propertyKeyFrom("Price", ["price", "price_2"])).toBe("price_3");
  expect(propertyKeyFrom("  --Status--  ")).toBe("status");
});

it("makes any formula name an identifier expressions can use", () => {
  expect(formulaNameFrom("Total (EUR)")).toBe("total_eur");
  expect(formulaNameFrom("price-per-kg")).toBe("price_per_kg");
  expect(formulaNameFrom("1st", ["formula_1st"])).toBe("formula_1st_2");
  expect(formulaNameFrom("")).toBe("formula");
});
