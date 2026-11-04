import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCount, extractTopics, parseSearchFeeds, parseFeedDetail } from "../src/parse.ts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("parseCount reads plain digit strings", () => {
  assert.equal(parseCount("1168"), 1168);
  assert.equal(parseCount(42), 42);
});

test("parseCount expands 万 / 亿 and ignores a trailing +", () => {
  assert.equal(parseCount("1.2万"), 12000);
  assert.equal(parseCount("10万+"), 100000);
  assert.equal(parseCount("3.4亿"), 340000000);
});

test("parseCount returns null for empty or unreadable values", () => {
  assert.equal(parseCount(""), null);
  assert.equal(parseCount(undefined), null);
  assert.equal(parseCount("赞"), null);
});

test("extractTopics pulls #话题# tags out of a note description", () => {
  assert.deepEqual(extractTopics("正文\n#AI聊天[话题]# #思考[话题]#"), ["AI聊天", "思考"]);
  assert.deepEqual(extractTopics("没有话题"), []);
});

test("parseSearchFeeds normalizes the engine's search response", () => {
  const rows = parseSearchFeeds(fixture("search_feeds.json"));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    noteId: "6a55d2e9000000001c0257cd",
    xsecToken: "AB7XfP804NfeBKARheTK3txRiCNx5rkXhCDilJGXbrDPw=",
    title: "智能体好啊 智能体得学啊",
    noteType: "normal",
    authorId: "67be8bd0000000000e012d82",
    authorName: "雨心.曲琦👊",
    likes: 1168,
    collects: 351,
    comments: 136,
    shares: 609,
    rank: 1,
  });
  assert.equal(rows[1].rank, 2);
});

test("parseSearchFeeds skips entries that are not notes or lack an id", () => {
  const rows = parseSearchFeeds({ feeds: [{ modelType: "hot_query", id: "x" }, { modelType: "note" }] });
  assert.deepEqual(rows, []);
});

test("parseFeedDetail extracts text, topics, publish time, images and comments", () => {
  const d = parseFeedDetail(fixture("feed_detail.json"));
  assert.equal(d.noteId, "6aa38170000000001001cf90");
  assert.equal(d.title, "为什么AI陪伴产品最后都死了？");
  assert.ok(d.description.startsWith("我们可能并不缺一个随时愿意提供陪伴的人。"));
  assert.equal(d.imageCount, 7);
  assert.deepEqual(d.tags.slice(0, 3), ["AI聊天", "思考", "AI陪伴"]);
  assert.equal(d.publishedAt, new Date(1789100400000).toISOString());
  assert.equal(d.counts.shares, null); // sharedCount is "" in this response
  assert.equal(d.comments.length, 2);
  assert.deepEqual(d.comments[0], { commentId: "6aa49bdb000000000b017c65", content: d.comments[0].content, likes: 11 });
  assert.ok(d.comments[0].content.startsWith("玩过两三个月人机恋"));
});
