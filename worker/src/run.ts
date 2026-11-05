// Daily XHS discovery run. Code collects (one engine call at a time, paced), the database stores,
// Haiku only judges: niche on/off, keyword ideas, opportunity cards, drafts for saved cards.
// Usage: node src/run.ts [--jitter]   (--jitter = random 0–40 min start delay, for scheduled runs)
import { hostname } from "node:os";
import { readFileSync } from "node:fs";
import { config } from "./env.ts";
import { db, check } from "./db.ts";
import { ensureEngine, pause, type Engine } from "./engine.ts";
import { haiku } from "./llm.ts";
import { parseSearchFeeds, parseFeedDetail, type SearchRow } from "./parse.ts";
import { growthPerDay, scoreNote, pickDetailCandidates, keepCitedCards } from "./score.ts";
import { draftProblems } from "./gate.ts";
import * as P from "./prompts.ts";

const DAY = 24 * 3600_000;
const counts: Record<string, number> = {};
const bump = (k: string, n = 1) => (counts[k] = (counts[k] || 0) + n);
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const shuffle = <T>(a: T[]) => a.map((v) => [Math.random(), v] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
const chunk = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function llm<T>(prompt: string, schema: object): Promise<T> {
  const { data, costUsd } = await haiku<T>(prompt, schema);
  bump("llm_calls");
  counts.llm_cost_usd = Math.round(((counts.llm_cost_usd || 0) + costUsd) * 1e4) / 1e4;
  return data;
}

async function activeKeywords(): Promise<string[]> {
  let rows = check(await db.from("keywords").select("keyword").eq("status", "active"), "load keywords");
  if (!rows.length) {
    const seeds: string[] = JSON.parse(readFileSync(new URL("../seed-keywords.json", import.meta.url), "utf8"));
    check(await db.from("keywords").insert(seeds.map((keyword) => ({ keyword, source: "seed" }))), "seed keywords");
    rows = seeds.map((keyword) => ({ keyword }));
    log(`seeded ${seeds.length} keywords`);
  }
  return rows.map((r) => r.keyword);
}

async function searchAll(engine: Engine, keywords: string[], deadline: number) {
  const seen = new Map<string, SearchRow & { keyword: string }>();
  for (const keyword of shuffle(keywords)) {
    if (Date.now() > deadline) { bump("stopped_at_deadline"); break; }
    try {
      const rows = parseSearchFeeds(await engine.call("search_feeds", { keyword }));
      bump("searches");
      bump("search_results", rows.length);
      for (const r of rows) if (!seen.has(r.noteId)) seen.set(r.noteId, { ...r, keyword });
    } catch (e) {
      bump("search_errors");
      log("search failed", keyword, String(e));
    }
    await pause();
  }
  return seen;
}

async function main() {
  if (process.argv.includes("--jitter")) await new Promise((r) => setTimeout(r, Math.random() * 40 * 60_000));
  const deadline = Date.now() + config.maxRunMinutes * 60_000;
  const run = check(await db.from("job_runs").insert({ job: "xhs-discovery", host: hostname() }).select("id").single(), "start run");
  let stopEngine = () => {};
  let engine: Engine | null = null;
  try {
    const started = await ensureEngine();
    engine = started.engine;
    stopEngine = started.stop;
    const login = String(await engine.call("check_login_status"));
    if (!login.includes("已登录")) throw new Error("LOGIN_REQUIRED — run the login tool (see RUNBOOK.md)");

    // 1–2. search every active keyword
    const seen = await searchAll(engine, await activeKeywords(), deadline);
    const ids = [...seen.keys()];
    if (!ids.length) throw new Error("no search results at all — engine or account problem");

    // 3. store notes + today's snapshot
    const existing = new Map(
      check(await db.from("notes").select("note_id, niche, detail_fetched_at").in("note_id", ids), "load notes").map((n) => [n.note_id, n]),
    );
    const now = new Date().toISOString();
    const fresh = ids.filter((id) => !existing.has(id)).map((id) => seen.get(id)!);
    if (fresh.length)
      check(await db.from("notes").insert(fresh.map((r) => ({
        note_id: r.noteId, xsec_token: r.xsecToken, title: r.title, note_type: r.noteType,
        author_id: r.authorId, author_name: r.authorName, first_keyword: r.keyword,
      }))), "insert notes");
    for (const id of ids.filter((id) => existing.has(id))) {
      const r = seen.get(id)!;
      check(await db.from("notes").update({ xsec_token: r.xsecToken, title: r.title, last_seen_at: now }).eq("note_id", id), "touch note");
    }
    bump("notes_new", fresh.length);
    bump("notes_seen", ids.length);

    const prevRows = check(
      await db.from("note_snapshots").select("note_id, likes, collects, comments, captured_at").in("note_id", ids).order("captured_at", { ascending: false }),
      "load snapshots",
    );
    const prev = new Map<string, (typeof prevRows)[number]>();
    for (const s of prevRows) if (!prev.has(s.note_id)) prev.set(s.note_id, s);
    check(await db.from("note_snapshots").insert(ids.map((id) => {
      const r = seen.get(id)!;
      return { note_id: id, run_id: run.id, keyword: r.keyword, search_rank: r.rank, likes: r.likes, collects: r.collects, comments: r.comments, shares: r.shares };
    })), "insert snapshots");

    // 4. Haiku: niche on/off for anything not yet classified
    const niche = new Map<string, string | null>(ids.map((id) => [id, existing.get(id)?.niche ?? null]));
    for (const batch of chunk(ids.filter((id) => !niche.get(id)), 40)) {
      const res = await llm<{ items: { note_id: string; niche: "on" | "off"; reason: string }[] }>(
        P.classifyPrompt(batch.map((id) => ({ note_id: id, title: seen.get(id)!.title, keyword: seen.get(id)!.keyword, author: seen.get(id)!.authorName }))),
        P.classifySchema,
      );
      const asked = new Set(batch);
      for (const it of res.items.filter((it) => asked.has(it.note_id))) {
        niche.set(it.note_id, it.niche);
        check(await db.from("notes").update({ niche: it.niche, niche_reason: it.reason, classified_at: now }).eq("note_id", it.note_id), "classify note");
        bump(it.niche === "on" ? "classified_on" : "classified_off");
      }
    }

    // 5. score: momentum over size, saves over likes
    const nowMs = Date.now();
    const scored = ids.map((id) => {
      const r = seen.get(id)!;
      const p = prev.get(id);
      const growth = growthPerDay({ ...r, at: nowMs }, p ? { ...p, at: Date.parse(p.captured_at) } : undefined);
      const fetched = existing.get(id)?.detail_fetched_at;
      return { noteId: id, row: r, growth, score: scoreNote(r, growth), niche: niche.get(id) ?? null,
               detailFresh: !!fetched && nowMs - Date.parse(fetched) < 3 * DAY };
    });

    // 6. full details + comments for the top on-niche notes only
    const detailed: object[] = [];
    for (const n of pickDetailCandidates(scored, config.detailsPerRun)) {
      if (Date.now() > deadline) break;
      try {
        const d = parseFeedDetail(await engine.call("get_feed_detail", { feed_id: n.noteId, xsec_token: n.row.xsecToken }));
        check(await db.from("notes").update({
          description: d.description, image_count: d.imageCount, tags: d.tags, published_at: d.publishedAt, detail_fetched_at: new Date().toISOString(),
        }).eq("note_id", n.noteId), "store detail");
        if (d.comments.length)
          check(await db.from("note_comments").upsert(d.comments.slice(0, 10).map((c) => ({ note_id: n.noteId, comment_id: c.commentId, content: c.content, likes: c.likes })),
            { onConflict: "note_id,comment_id" }), "store comments");
        detailed.push({
          note_id: n.noteId, title: d.title, excerpt: d.description.slice(0, 300), tags: d.tags,
          likes: n.row.likes, collects: n.row.collects, comments: n.row.comments,
          growth_per_day: n.growth === null ? null : Math.round(n.growth),
          save_ratio: Math.round(((n.row.collects || 0) / Math.max(n.row.likes || 0, 1)) * 100) / 100,
          top_comments: d.comments.slice(0, 5).map((c) => c.content.slice(0, 80)),
        });
        bump("details");
      } catch (e) {
        bump("detail_errors");
        log("detail failed", n.noteId, String(e));
      }
      await pause();
    }

    if (detailed.length) {
      const known = new Set(detailed.map((d: any) => d.note_id as string));

      // 7. Haiku: keyword ideas → validated by a real search before they can be activated
      const current = check(await db.from("keywords").select("keyword"), "all keywords").map((k) => k.keyword);
      const ideas = await llm<{ keywords: { keyword: string; reason: string; evidence_note_ids: string[] }[] }>(
        P.keywordPrompt(current, detailed.map((d: any) => ({ note_id: d.note_id, title: d.title, tags: d.tags, comments: d.top_comments }))),
        P.keywordSchema,
      );
      for (const k of ideas.keywords.filter((k) => k.keyword.trim() && !current.includes(k.keyword.trim()))) {
        if (Date.now() > deadline) break;
        let results = 0;
        try { results = parseSearchFeeds(await engine.call("search_feeds", { keyword: k.keyword.trim() })).length; } catch {}
        await pause();
        check(await db.from("keywords").insert({
          keyword: k.keyword.trim(), status: "candidate", source: "proposed",
          proposed_reason: `${k.reason}（依据 ${k.evidence_note_ids.join(", ")}；验证搜索 ${results} 条）`,
          validated_at: results >= 10 ? new Date().toISOString() : null,
        }), "insert keyword idea");
        bump("keyword_ideas");
      }

      // 8. Haiku: opportunity cards; 9. code drops any card that cites notes we don't have
      const { cards } = await llm<{ cards: any[] }>(P.cardPrompt(detailed), P.cardSchema);
      const kept = keepCitedCards(cards, known);
      bump("cards_dropped", cards.length - kept.length);
      if (kept.length)
        check(await db.from("opportunities").insert(kept.map((c) => ({
          run_id: run.id, title: c.title, summary: c.summary, why_now: c.why_now, angle: c.angle,
          evidence_note_ids: c.evidence_note_ids, keywords: c.keywords, score: c.score,
        }))), "insert cards");
      bump("cards", kept.length);
    }

    // Drafts for cards the operator saved on the dashboard (gate-checked, one retry with feedback).
    const saved = check(await db.from("opportunities").select("*").eq("status", "saved"), "saved cards");
    for (const card of saved) {
      const sources = check(await db.from("notes").select("note_id, title, description, tags").in("note_id", card.evidence_note_ids), "card sources")
        .map((s) => ({ ...s, description: (s.description || "").slice(0, 400) }));
      let draft = await llm<{ title: string; body: string; topics: string[]; cover_text: string }>(P.draftPrompt(card, sources), P.draftSchema);
      let problems = draftProblems(draft);
      if (problems.length) {
        draft = await llm(P.draftPrompt(card, sources, problems.join("；")), P.draftSchema);
        problems = draftProblems(draft);
      }
      check(await db.from("drafts").insert({ opportunity_id: card.id, title: draft.title, body: draft.body, topics: draft.topics, cover_text: draft.cover_text }), "insert draft");
      check(await db.from("opportunities").update({ status: "drafted" }).eq("id", card.id), "mark drafted");
      bump(problems.length ? "drafts_with_problems" : "drafts");
    }

    // Account stats — optional: upstream get_my_profile currently times out from an overseas IP.
    try {
      const me = await engine.call("get_my_profile");
      const ia = me?.userBasicInfo ? me : me?.data || me;
      // Shape unverified (the tool has never succeeded for us) — only write when a fan count is really there.
      const pick = (label: string) => Number((ia?.interactions || []).find((x: any) => x.name === label || x.type === label)?.count) || null;
      if (pick("fans") === null) throw new Error("unrecognized get_my_profile shape: " + JSON.stringify(me).slice(0, 200));
      check(await db.from("account_snapshots").insert({ fans: pick("fans"), follows: pick("follows"), interactions: pick("interaction") }), "account snapshot");
      bump("account_snapshot");
    } catch (e) {
      bump("account_snapshot_failed");
      log("account snapshot skipped:", String(e).slice(0, 120));
    }

    check(await db.from("job_runs").update({ status: "ok", finished_at: new Date().toISOString(), counts }).eq("id", run.id), "finish run");
    log("done", counts);
  } catch (e) {
    process.exitCode = 1;
    log("run failed:", String(e));
    await db.from("job_runs").update({ status: "error", finished_at: new Date().toISOString(), counts, error: String(e).slice(0, 1000) }).eq("id", run.id);
  } finally {
    await engine?.close();
    stopEngine();
  }
}

await main();
