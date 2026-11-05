// Read-only health probe (no database): engine reachable + logged in, one search parses, Haiku classifies.
// Usage: node src/probe.ts [keyword]
import { ensureEngine } from "./engine.ts";
import { haiku } from "./llm.ts";
import { parseSearchFeeds } from "./parse.ts";
import { classifyPrompt, classifySchema } from "./prompts.ts";

const keyword = process.argv[2] || "AI智能体";
const { engine, stop } = await ensureEngine();
try {
  console.log("login:", String(await engine.call("check_login_status")).split("\n")[0]);
  const rows = parseSearchFeeds(await engine.call("search_feeds", { keyword }));
  console.log(`search "${keyword}": ${rows.length} notes`);
  const sample = rows.slice(0, 10).map((r) => ({ note_id: r.noteId, title: r.title, keyword, author: r.authorName }));
  const { data, costUsd } = await haiku<{ items: { note_id: string; niche: string; reason: string }[] }>(classifyPrompt(sample), classifySchema);
  const byId = new Map(data.items.map((i) => [i.note_id, i]));
  for (const r of rows.slice(0, 10)) {
    const c = byId.get(r.noteId);
    console.log(` ${c?.niche ?? "??"}  赞${r.likes} 藏${r.collects}  ${r.title}  — ${c?.reason ?? "MISSING"}`);
  }
  console.log(`classified ${data.items.length}/${sample.length}, cost $${costUsd.toFixed(4)}`);
} finally {
  await engine.close();
  stop();
}
