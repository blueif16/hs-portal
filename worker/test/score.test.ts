import { test } from "node:test";
import assert from "node:assert/strict";
import { engagement, growthPerDay, scoreNote, pickDetailCandidates, keepCitedCards } from "../src/score.ts";

const HOUR = 3600_000;

test("engagement weights collects and comments above likes", () => {
  const likesOnly = engagement({ likes: 100, collects: 0, comments: 0 });
  const collectsOnly = engagement({ likes: 0, collects: 100, comments: 0 });
  const commentsOnly = engagement({ likes: 0, collects: 0, comments: 100 });
  assert.ok(collectsOnly > likesOnly);
  assert.ok(commentsOnly > collectsOnly);
});

test("engagement treats missing counts as zero", () => {
  assert.equal(engagement({ likes: null, collects: null, comments: null }), 0);
});

test("growthPerDay is null without an earlier snapshot", () => {
  assert.equal(growthPerDay({ likes: 10, collects: 0, comments: 0, at: 0 }, undefined), null);
});

test("growthPerDay normalizes engagement change to a 24h rate", () => {
  const prev = { likes: 100, collects: 0, comments: 0, at: 0 };
  const now = { likes: 150, collects: 0, comments: 0, at: 12 * HOUR };
  assert.equal(growthPerDay(now, prev), 100); // +50 in 12h → 100/day
});

test("a fast-growing note outranks a bigger note that has stalled", () => {
  const stalled = scoreNote({ likes: 20000, collects: 5000, comments: 300 }, 0);
  const rising = scoreNote({ likes: 800, collects: 400, comments: 60 }, 2000);
  assert.ok(rising > stalled);
});

test("with equal size and growth, a higher collect ratio scores higher", () => {
  const casual = scoreNote({ likes: 1000, collects: 100, comments: 50 }, 100);
  const saveWorthy = scoreNote({ likes: 1000, collects: 900, comments: 50 }, 100);
  assert.ok(saveWorthy > casual);
});

test("pickDetailCandidates returns only on-niche notes, best score first, capped at k", () => {
  const notes = [
    { noteId: "a", niche: "on", score: 1, detailFresh: false },
    { noteId: "b", niche: "off", score: 9, detailFresh: false },
    { noteId: "c", niche: "on", score: 5, detailFresh: false },
    { noteId: "d", niche: "on", score: 3, detailFresh: false },
    { noteId: "e", niche: null, score: 8, detailFresh: false },
  ];
  assert.deepEqual(pickDetailCandidates(notes, 2).map((n) => n.noteId), ["c", "d"]);
});

test("pickDetailCandidates skips notes whose details were fetched recently", () => {
  const notes = [
    { noteId: "a", niche: "on", score: 9, detailFresh: true },
    { noteId: "b", niche: "on", score: 2, detailFresh: false },
  ];
  assert.deepEqual(pickDetailCandidates(notes, 5).map((n) => n.noteId), ["b"]);
});

test("keepCitedCards drops cards that cite nothing or cite unknown notes", () => {
  const known = new Set(["n1", "n2"]);
  const cards = [
    { title: "ok", evidence_note_ids: ["n1", "n2"] },
    { title: "none", evidence_note_ids: [] },
    { title: "invented", evidence_note_ids: ["n1", "zzz"] },
  ];
  assert.deepEqual(keepCitedCards(cards, known).map((c) => c.title), ["ok"]);
});
