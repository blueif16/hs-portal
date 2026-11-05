import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordHeat, planKeywords } from "../src/keywords.ts";

const kw = (keyword: string, status: "active" | "candidate", heat: number, onShare = 0.9, prevBelow = false) =>
  ({ keyword, status, heat, onShare, prevBelow });
const byKeyword = (plans: ReturnType<typeof planKeywords>) => Object.fromEntries(plans.map((p) => [p.keyword, p]));

test("keywordHeat sums the engagement of every note on the keyword's page", () => {
  const page = [
    { likes: 100, collects: 10, comments: 5 },  // 100 + 15 + 10 = 125
    { likes: 40, collects: null, comments: 0 }, // 40
  ];
  assert.equal(keywordHeat(page), 165);
});

test("the hottest eligible keywords up to the cap make the cut", () => {
  const plan = byKeyword(planKeywords([kw("a", "active", 50), kw("b", "active", 900), kw("c", "active", 300)], 2));
  assert.equal(plan.b.inCut, true);
  assert.equal(plan.c.inCut, true);
  assert.equal(plan.a.inCut, false);
});

test("a keyword with under 60% on-niche results never makes the cut, however hot", () => {
  const plan = byKeyword(planKeywords([kw("broad", "active", 99999, 0.4), kw("niche", "active", 10)], 5));
  assert.equal(plan.broad.inCut, false);
  assert.equal(plan.niche.inCut, true);
});

test("a candidate that makes the cut is activated, with a reason", () => {
  const plan = byKeyword(planKeywords([kw("new", "candidate", 500)], 20));
  assert.equal(plan.new.to, "active");
  assert.ok(plan.new.reason);
});

test("a keyword that misses the cut for the first time keeps its status", () => {
  const plan = byKeyword(planKeywords([kw("hot", "active", 900), kw("cold", "active", 5), kw("cand", "candidate", 1)], 1));
  assert.equal(plan.cold.to, null);
  assert.equal(plan.cand.to, null);
});

test("a keyword that misses the cut twice in a row is retired, with a reason", () => {
  const plan = byKeyword(planKeywords([
    kw("hot", "active", 900),
    kw("cold", "active", 5, 0.9, true),
    kw("cand", "candidate", 1, 0.9, true),
  ], 1));
  assert.equal(plan.cold.to, "retired");
  assert.equal(plan.cand.to, "retired");
  assert.ok(plan.cold.reason);
});

test("an active keyword that stays in the cut is left alone even after an earlier miss", () => {
  const plan = byKeyword(planKeywords([kw("back", "active", 900, 0.9, true)], 5));
  assert.equal(plan.back.to, null);
});
