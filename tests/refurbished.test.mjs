import assert from "node:assert/strict";
import test from "node:test";
import { isRefurbished, keepRefurbishedInDraft } from "../src/lib/mhd-importer/refurbished.ts";

test("reacondicionados por familia, título o subfamilia de MHD", () => {
  assert.equal(isRefurbished("smartphones-reacondicionados"), true);
  assert.equal(isRefurbished("portatiles-reacondicionados"), true);
  assert.equal(isRefurbished("moviles", "Móviles", "Smartphones Reacondicionados"), true);
  assert.equal(isRefurbished("Tablets REACONDICIONADAS"), true);
  assert.equal(isRefurbished("smartphones", "Smartphones", null), false);
  assert.equal(keepRefurbishedInDraft("smartphones-reacondicionados"), true);
  assert.equal(keepRefurbishedInDraft(undefined, null), false);
});
