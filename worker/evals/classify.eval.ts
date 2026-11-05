// Eval for the niche classifier prompt: real titles from run #3 (2026-11-05), labelled by hand.
// Bar: no expected-off note labelled on, and at most 2 of 16 expected-on notes missed. Usage: node evals/classify.eval.ts [runs]
import { readFileSync } from "node:fs";
import { haiku } from "../src/llm.ts";
import { classifyPrompt, classifySchema } from "../src/prompts.ts";

type Case = { id: string; keyword: string; title: string; expect: "on" | "off" };
const cases: Case[] = JSON.parse(readFileSync(new URL("./classify-golden.json", import.meta.url), "utf8"));
const runs = Number(process.argv[2] || 2);
let failed = false;
for (let i = 1; i <= runs; i++) {
  const { data } = await haiku<{ items: { note_id: string; niche: string; reason: string }[] }>(
    classifyPrompt(cases.map((c) => ({ note_id: c.id, title: c.title, keyword: c.keyword, author: null }))), classifySchema);
  const got = new Map(data.items.map((it) => [it.note_id, it]));
  const missedOn = cases.filter((c) => c.expect === "on" && got.get(c.id)?.niche !== "on");
  const falseOn = cases.filter((c) => c.expect === "off" && got.get(c.id)?.niche !== "off");
  const pass = falseOn.length === 0 && missedOn.length <= 2;
  failed ||= !pass;
  console.log(`run ${i}: ${pass ? "PASS" : "FAIL"} — missed on ${missedOn.length}/16, wrongly on ${falseOn.length}/14`);
  for (const c of [...missedOn, ...falseOn]) console.log(`   ${c.expect === "on" ? "missed" : "false on"} ${c.id} [${c.keyword}] ${c.title} — ${got.get(c.id)?.reason}`);
}
process.exitCode = failed ? 1 : 0;
