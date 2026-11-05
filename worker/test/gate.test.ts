import { test } from "node:test";
import assert from "node:assert/strict";
import { draftProblems } from "../src/gate.ts";

const good = { title: "三步搭一个能用的AI智能体", body: "正".repeat(300), topics: ["AI智能体", "效率工具", "教程"], cover_text: "三步搭智能体" };
const only = (problems: string[], field: RegExp) => {
  assert.equal(problems.length, 1, `expected one problem, got ${JSON.stringify(problems)}`);
  assert.match(problems[0], field);
};

test("a draft inside every limit has no problems", () => {
  assert.deepEqual(draftProblems(good), []);
});

test("title length is counted in characters, 8–20", () => {
  only(draftProblems({ ...good, title: "太短了" }), /title/);
  only(draftProblems({ ...good, title: "长".repeat(21) }), /title/);
  assert.deepEqual(draftProblems({ ...good, title: "😀".repeat(11) }), []); // 11 chars, but 22 UTF-16 units
});

test("body must be 80–1000 characters", () => {
  only(draftProblems({ ...good, body: "短".repeat(79) }), /body/);
  only(draftProblems({ ...good, body: "长".repeat(1001) }), /body/);
});

test("fewer than 3 topics is a problem", () => {
  only(draftProblems({ ...good, topics: ["一", "二"] }), /topics/);
});

test("contact-info bait is flagged", () => {
  only(draftProblems({ ...good, body: good.body + "想要资料私信我" }), /引流|contact/);
});
