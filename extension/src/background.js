// background.js — service worker orchestrator.
//
// Replaces Redaily's cloud "WHAT" plane (tRPC → yanghao.app, auth_session, membership)
// with a LOCAL config + Plan store. No phone-home. Routes popup commands to the content
// engine in the active XHS tab, owns local config (caps for the Tier-1 governor) and the
// current Plan (the human/AI-authored task definition — see lib/plan.js).

importScripts("lib/secrets.local.js", "lib/plan.js", "lib/governor.js", "lib/planner.js"); // globalThis.__hs.{secrets,plan,governor,planner}
const PLAN = globalThis.__hs.plan;
const GOV = globalThis.__hs.governor;
const PLANNER = globalThis.__hs.planner;
const SECRETS = (globalThis.__hs && globalThis.__hs.secrets) || {};

// Recent runner events (for the popup's live log + backfill on open). In-memory; the
// SW stays alive during a session because the content runner pings it every action.
const RECENT = []; // capped — what the popup renders live
const SESSIONLOG = []; // full session log — exported to a file for offline inspection
function pushEvent(ev) {
  RECENT.push(ev);
  if (RECENT.length > 80) RECENT.shift();
  SESSIONLOG.push(ev);
  if (SESSIONLOG.length > 5000) SESSIONLOG.shift();
}

// exportLog — write the FULL session log to ~/Downloads/hs-portal/session-log.jsonl
// (overwriting each time) so it can be read directly without copy-paste from the popup.
// MV3 service workers have no Blob URL (no createObjectURL), so we encode a data: URL.
// Best-effort: any failure is recorded, never thrown into the session loop.
async function exportLog(reason) {
  try {
    if (!SESSIONLOG.length) return null;
    const head = { t: Date.now(), level: "meta", line: "=== hs-portal log (" + (reason || "export") + ") · " + new Date().toISOString() + " ===" };
    const body =
      [head, ...SESSIONLOG]
        .map((e) => JSON.stringify({ time: new Date(e.t || Date.now()).toISOString(), level: e.level || "info", line: e.line || "", url: e.url || undefined }))
        .join("\n") + "\n";
    const url = "data:application/json;charset=utf-8," + encodeURIComponent(body);
    await chrome.downloads.download({ url, filename: "hs-portal/session-log.json", conflictAction: "overwrite", saveAs: false });
    return true;
  } catch (e) {
    pushEvent({ t: Date.now(), level: "err", line: "log export failed: " + String((e && e.message) || e) });
    return false;
  }
}

async function loadGov() {
  const c = await chrome.storage.local.get("hs_gov");
  return c.hs_gov || GOV.createGovState();
}
async function saveGov(state) {
  await chrome.storage.local.set({ hs_gov: state });
}
// warmingState — the account's warming PHASE, derived from real account state (not a
// per-plan literal): fans count + how long we've been running it. Returns the phase key,
// a human label, and a cap SCALE in (0,1]. The scale is the MIN of a fans-based and an
// age-based scale so neither a young account nor a tiny account can act at full caps.
// Unknown fans → earliest phase (safest). Pure; reads only the passed account + config.
function warmingState(acc, wcfg) {
  const w = wcfg || DEFAULT_CONFIG.warming;
  const fans = acc && acc.totals && acc.totals.fans != null ? acc.totals.fans : null;
  const firstT = acc && acc.history && acc.history.length ? acc.history[0].t : null;
  const ageDays = firstT ? (Date.now() - firstT) / 86400000 : 0;
  const fScale = fans == null ? w.earlyScale : fans < w.smallFans ? w.earlyScale : fans < w.midFans ? w.midScale : 1;
  const aScale = ageDays < w.earlyDays ? w.earlyScale : ageDays < w.midDays ? w.midScale : 1;
  const scale = Math.min(fScale, aScale);
  const key = scale <= w.earlyScale ? "warming_early" : scale < 1 ? "warming" : "active";
  const label = key === "warming_early" ? "早期养号" : key === "warming" ? "稳步养号" : "活跃期";
  return { key, label, scale, fans, ageDays: Math.floor(ageDays) };
}

// getEffectiveCaps — the base caps SCALED by the current warming phase. This is what the
// governor actually enforces, so a fresh account is throttled automatically with zero
// operator input. Scale 1 (active phase) returns the base caps untouched.
async function getEffectiveCaps() {
  const c = await chrome.storage.local.get(["hs_config", "hs_account"]);
  const cfg = c.hs_config || DEFAULT_CONFIG;
  const base = cfg.caps || DEFAULT_CONFIG.caps;
  const { scale } = warmingState(c.hs_account, cfg.warming || DEFAULT_CONFIG.warming);
  if (scale >= 1) return base;
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = {};
    if (v.perHour != null) out[k].perHour = Math.max(1, Math.round(v.perHour * scale));
    if (v.perDay != null) out[k].perDay = Math.max(1, Math.round(v.perDay * scale));
  }
  return out;
}

const DEFAULT_CONFIG = {
  schemaVersion: 1,
  humanize: { minDelayMs: 600, maxDelayMs: 2500 },
  // Caps are not yet enforced in M0 (that's the Tier-1 governor). Stored now so the
  // UI can display them and the governor has a home. Values are conservative starters.
  caps: {
    like: { perHour: 30, perDay: 200 },
    collect: { perDay: 50 },
    follow: { perHour: 10, perDay: 50 },
    comment: { perHour: 10, perDay: 40 },
  },
  // Warming curve — caps are SCALED DOWN for younger/smaller accounts (best-practice 养号:
  // a fresh account must ramp slowly). The effective scale is the min of a fans-based and an
  // age-based scale, so a bought-fans-but-2-days-old account is still throttled. Thresholds
  // live here (tunable), never as magic literals in the logic. fans/ageDays read from
  // hs_account; unknown fans → treated as the earliest phase (most conservative).
  warming: {
    smallFans: 100, // < this → earliest phase
    midFans: 1000, // < this → middle phase
    earlyDays: 7, // first week of us running it → cap the scale at earlyScale
    midDays: 30, // first month → cap at midScale
    earlyScale: 0.4,
    midScale: 0.7, // activeScale is always 1.0
  },
  // Auto-seed — how much work a self-feeding (seedSource:"auto") plan pulls per run. The
  // governor's action caps still do the real limiting; these just bound the outer work-list.
  autoSeed: {
    commentNotesPerRun: 4, // comment_section: how many discovered notes to harvest per run
    profileVisitsPerRun: 6, // profile: how many accumulated leads to visit per run
  },
  // AI planner endpoint (OpenAI-compatible). The planner only EMITS a Plan; the operator
  // reviews it in the editor before saving/running. apiKey is set via Settings in the popup.
  ai: { endpoint: "https://api.tokenfactory.us-central1.nebius.com/v1/chat/completions", model: "Qwen/Qwen3.5-397B-A17B", apiKey: "" },
};

// aiConfig — resolve the AI endpoint/model/key. The BUNDLED secret (secrets.local.js,
// written by the key-install one-liner) wins for any field it provides, so the operator
// never has to touch the Settings UI. Falls back to stored config, then DEFAULT_CONFIG.
function aiConfig(stored) {
  const s = SECRETS.ai || {};
  const base = stored || DEFAULT_CONFIG.ai;
  return {
    endpoint: s.endpoint || base.endpoint || DEFAULT_CONFIG.ai.endpoint,
    model: s.model || base.model || DEFAULT_CONFIG.ai.model,
    apiKey: s.apiKey || base.apiKey || "",
  };
}

const XHS_RE = /(?:^|\.)xiaohongshu\.com|(?:^|\.)rednote\.com/;

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get(["hs_config", "hs_plan", "hs_gov", "hs_plans"]);
  if (!cur.hs_config) await chrome.storage.local.set({ hs_config: DEFAULT_CONFIG });
  if (!cur.hs_plan) await chrome.storage.local.set({ hs_plan: PLAN.createDefaultPlan() });
  if (!cur.hs_gov) await chrome.storage.local.set({ hs_gov: GOV.createGovState() });
  if (!cur.hs_plans) await chrome.storage.local.set({ hs_plans: [], hs_active_plan_id: null });
  // Arm the 错峰 auto-scheduler from any existing scheduled plans (defined below).
  await syncSchedules();
});

async function activeXhsTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return null;
  try {
    return XHS_RE.test(new URL(tab.url).hostname) ? tab : null;
  } catch {
    return null;
  }
}

async function runOnContent(action, args) {
  const tab = await activeXhsTab();
  if (!tab) return { ok: false, error: "No active Xiaohongshu tab — open a note and try again." };
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "hs:action", action, args });
  } catch (e) {
    return {
      ok: false,
      error: "Content engine not reachable on this tab. Reload the XHS page after loading the extension. (" + String((e && e.message) || e) + ")",
    };
  }
}

// =====================================================================
// PLAN LIBRARY (save/recall multiple plans)
// A library entry = a normalized Plan + { id, name, source, savedAt, lastRunAt }.
// Storage: hs_plans (array, capped 30), hs_active_plan_id (string|null). The existing
// hs_plan key stays the "current/active working plan" (what the editor + hs:getPlan use)
// and is set to the active entry on every save/select.
// =====================================================================
async function loadPlans() {
  const c = await chrome.storage.local.get(["hs_plans", "hs_active_plan_id"]);
  return { plans: Array.isArray(c.hs_plans) ? c.hs_plans : [], activeId: c.hs_active_plan_id || null };
}
async function savePlans(plans, activeId) {
  await chrome.storage.local.set({ hs_plans: plans.slice(-30), hs_active_plan_id: activeId || null });
}
function autoName(plan) {
  return plan.name && plan.name.trim()
    ? plan.name.trim()
    : plan.mode + " · " + (plan.subject ? plan.subject.slice(0, 28) : new Date().toLocaleString());
}
// upsertPlan — insert or update by id; assign a fresh id when missing OR when the id isn't
// already in the library (default ids like "plan_discovery" collide → treat as new).
async function upsertPlan(rawPlan, name, source) {
  const norm = PLAN.normalizePlan(rawPlan);
  let { plans } = await loadPlans();
  const existing = norm.id && plans.find((p) => p.id === norm.id);
  const now = Date.now();
  const entry = {
    ...norm,
    id: existing ? norm.id : PLAN.newPlanId(norm.mode),
    name: name && name.trim() ? name.trim() : autoName(norm),
    source: source || norm.source || "manual",
    savedAt: now,
    lastRunAt: existing ? existing.lastRunAt || 0 : 0,
  };
  plans = existing ? plans.map((p) => (p.id === entry.id ? entry : p)) : [...plans, entry];
  await savePlans(plans, entry.id);
  await chrome.storage.local.set({ hs_plan: entry }); // active working plan
  return { plans, entry };
}
function sortedPlans(plans) {
  return plans.slice().sort((a, b) => (b.lastRunAt || b.savedAt || 0) - (a.lastRunAt || a.savedAt || 0));
}

// =====================================================================
// ACCOUNT STATS (traction tracking)
// The dashboard's proof that the extension is doing anything: snapshot our OWN account's
// followers + 获赞与收藏 over time and show the growth (Δ since baseline). Two capture paths,
// both passive to the operator (no clicks):
//   • PASSIVE  — nethook.js (MAIN world) sniffs the page's own /user/me + /user/otherinfo
//                responses and forwards them (hs:account:observed). Free whenever the page
//                loads them (e.g. you, or the bot, view your profile).
//   • ACTIVE   — snapshotAccount(): resolve our user_id (fetchMe), then read counts via the
//                signed API (fetchSelfInfo) or, if x-s-gated, by navigating to our profile
//                and reading the verified DOM (readUser). Auto-fired at the end of every run.
// Store: hs_account = { selfId, nickname, baseline:Snap, latest:Snap, history:[Snap] } where
// Snap = { t, followers, following, likes }. Baseline is the first snapshot ever taken.
// =====================================================================
function parseCountBg(s) {
  s = (s == null ? "" : String(s)).trim();
  if (!s) return null;
  const num = parseFloat(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(num)) return null;
  if (/亿/.test(s)) return Math.round(num * 1e8);
  if (/万|w/i.test(s)) return Math.round(num * 1e4);
  return Math.round(num);
}
async function loadAccount() {
  const c = await chrome.storage.local.get("hs_account");
  const a = c.hs_account || {};
  return {
    selfId: a.selfId || null,
    nickname: a.nickname || "",
    totals: a.totals || null, // { fans, follows, interaction, t } — newest read
    newThisRun: a.newThisRun || null, // { fans, interaction } — Δ vs previous read
    history: Array.isArray(a.history) ? a.history : [], // [{ t, fans, interaction }] for the trend
    received: { likes: (a.received && a.received.likes) || [], followers: (a.received && a.received.followers) || [] },
    lastReadAt: a.lastReadAt || 0,
  };
}
async function saveAccount(acc) {
  await chrome.storage.local.set({ hs_account: acc });
}
// recordTotals — fold a fresh totals reading (粉丝/关注/获赞收藏). Computes newThisRun =
// Δ vs the PREVIOUS read (per-run gain, the operator's chosen signal), and appends a trend
// point. Returns the updated account.
async function recordTotals({ selfId, nickname, fans, follows, interaction }) {
  const acc = await loadAccount();
  if (selfId) acc.selfId = selfId;
  if (nickname) acc.nickname = nickname;
  if (fans == null && interaction == null) return acc; // nothing real to fold
  const prev = acc.totals;
  acc.newThisRun = {
    fans: prev && prev.fans != null && fans != null ? fans - prev.fans : null,
    interaction: prev && prev.interaction != null && interaction != null ? interaction - prev.interaction : null,
  };
  acc.totals = { fans: fans == null ? null : fans, follows: follows == null ? null : follows, interaction: interaction == null ? null : interaction, t: Date.now() };
  const last = acc.history[acc.history.length - 1];
  const point = { t: Date.now(), fans: fans == null ? null : fans, interaction: interaction == null ? null : interaction };
  if (last && point.t - last.t < 3600000) acc.history[acc.history.length - 1] = point; // collapse same-hour
  else acc.history.push(point);
  if (acc.history.length > 30) acc.history.shift();
  acc.lastReadAt = Date.now();
  await saveAccount(acc);
  return acc;
}

// recordReceived — merge interceptor notification items for a stream ("likes" | "followers"),
// deduped by stable id so re-reading the same page each run doesn't inflate counts. Drops
// events older than 30d and caps the array.
async function recordReceived(stream, items) {
  if (!items || !items.length || (stream !== "likes" && stream !== "followers")) return;
  const acc = await loadAccount();
  const arr = acc.received[stream] || [];
  const seen = new Set(arr.map((e) => e.id));
  for (const it of items) {
    const id = it.id != null ? String(it.id) : it.t != null ? "t" + it.t : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    arr.push({ id, t: it.t || Date.now() });
  }
  const cut = Date.now() - 30 * 86400000;
  acc.received[stream] = arr.filter((e) => !e.t || e.t >= cut).slice(-500);
  acc.lastReadAt = Date.now();
  await saveAccount(acc);
}
// interactionsToCounts — parse /user/otherinfo interactions[] into counts. Match by type/name
// (robust to ordering); if labels are absent, fall back to the reference client's confirmed
// POSITIONAL layout: [0]=follows, [1]=fans, [2]=interaction (获赞与收藏). (data_util.py)
function interactionsToCounts(interactions) {
  const arr = interactions || [];
  let followers = null, following = null, likes = null;
  for (const it of arr) {
    const key = (it.type || "") + "|" + (it.name || "");
    const n = parseCountBg(it.count);
    if (/fans|粉丝/.test(key)) followers = n;
    else if (/follows|关注/.test(key)) following = n;
    else if (/interaction|获赞|收藏/.test(key)) likes = n;
  }
  if (followers == null && following == null && likes == null && arr.length >= 3) {
    following = parseCountBg(arr[0] && arr[0].count);
    followers = parseCountBg(arr[1] && arr[1].count);
    likes = parseCountBg(arr[2] && arr[2].count);
  }
  return { followers, following, likes };
}

// snapshotAccount — ACTIVE capture. opts.tabId reuses an already-open XHS tab (e.g. the
// live automation window at session end); otherwise we briefly open an unfocused popup.
// Order: resolve selfId (fetchMe) → try the signed API (fetchSelfInfo, no nav) → else
// navigate to our profile and read the verified DOM. Returns { ok, account?, error? }.
async function snapshotAccount(opts = {}) {
  let tabId = opts.tabId || null;
  let transientWinId = null;
  try {
    if (!tabId && SESSION.windowTabId != null) {
      try {
        const t = await chrome.tabs.get(SESSION.windowTabId);
        if (t && t.url && XHS_RE.test(new URL(t.url).hostname)) tabId = t.id;
      } catch {}
    }
    // NOTE: never fall back to the operator's active tab (activeXhsTab) — reading the account
    // there would navigate the operator's own browser to /user/profile + /notification and
    // block them. When no automation window exists (e.g. a manual ↻ before any run), open a
    // dedicated background window instead.
    if (!tabId) {
      const w = await chrome.windows.create({ url: "https://www.xiaohongshu.com/explore?_t=" + Date.now(), type: "popup", width: 1024, height: 768, focused: false });
      transientWinId = w && w.id;
      tabId = w && w.tabs && w.tabs[0] && w.tabs[0].id;
      if (!tabId) return { ok: false, error: "could not open an XHS tab" };
      await waitTabLoaded(tabId);
      await contentRPC(tabId, "sleep", { min: 800, max: 1500 });
    }

    const acc = await loadAccount();
    let selfId = acc.selfId;
    let nickname = acc.nickname || "";
    const me = await contentRPC(tabId, "fetchMe");
    if (me && me.ok && me.userId) {
      selfId = me.userId;
      if (me.nickname) nickname = me.nickname;
    }
    if (!selfId) return { ok: false, error: "not logged in / could not resolve account id" };

    // Path 1: signed API counts (no nav). otherinfo is x-s-gated (live probe: 406) → usually fails.
    let counts = null;
    const info = await contentRPC(tabId, "fetchSelfInfo", { userId: selfId });
    if (info && info.ok && (info.followers != null || info.likes != null)) {
      counts = { fans: info.followers, follows: info.following, interaction: info.likes };
      if (info.nickname) nickname = info.nickname;
    }

    // Path 2: navigate to our profile, read the verified DOM (+ nethook captures otherinfo).
    if (!counts) {
      await chrome.tabs.update(tabId, { url: "https://www.xiaohongshu.com/user/profile/" + selfId });
      await waitTabLoaded(tabId);
      await contentRPC(tabId, "sleep", { min: 1500, max: 2600 });
      const u = (await contentRPC(tabId, "readUser")).user || {};
      if (u.followers != null || u.likes != null) {
        counts = { fans: u.followers, follows: u.following, interaction: u.likes };
        if (u.name) nickname = u.name;
      }
    }
    if (counts) await recordTotals({ selfId, nickname, ...counts });

    // Received engagement: open the notifications page so the page fires its SIGNED /you/likes
    // (default 赞和收藏 tab) and, after a tab switch, /you/connections (新增关注). nethook captures
    // both → recordReceived. Best-effort — these gated endpoints can't be fetched directly.
    if (opts.received !== false) {
      try {
        await chrome.tabs.update(tabId, { url: "https://www.xiaohongshu.com/notification" });
        await waitTabLoaded(tabId);
        await contentRPC(tabId, "sleep", { min: 1800, max: 2800 }); // /you/likes fires + is captured
        await contentRPC(tabId, "switchNotifTab", { label: "关注" }); // → /you/connections
        await contentRPC(tabId, "sleep", { min: 1500, max: 2400 });
      } catch (e) {}
    }

    const account = await loadAccount();
    const gotReceived = account.received.likes.length || account.received.followers.length;
    if (!counts && !gotReceived) return { ok: false, error: "could not read account (DOM + API + notifications all failed)" };
    event("account snapshot · fans " + (counts ? counts.fans : "?") + " · 获赞收藏 " + (counts ? counts.interaction : "?"), "muted");
    return { ok: true, account };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    if (transientWinId != null) {
      try {
        await chrome.windows.remove(transientWinId);
      } catch {}
    }
  }
}
// computeAccountView — derive the GUI shape (the operator's chosen "received-engagement"
// model): current totals + per-run gain + 7-day received likes/followers + a fans trend.
// A received count is null (shown "—") when that stream was never captured, vs 0 = a real
// quiet week.
function computeAccountView(acc) {
  if (!acc) return null;
  const t = acc.totals;
  const count7 = (stream) => {
    const arr = (acc.received && acc.received[stream]) || [];
    if (!arr.length) return null; // never captured → unknown
    const cut = Date.now() - 7 * 86400000;
    return arr.filter((e) => e.t && e.t >= cut).length;
  };
  return {
    hasData: !!(t || (acc.received && (acc.received.likes.length || acc.received.followers.length))),
    nickname: acc.nickname || "",
    fans: t ? t.fans : null,
    interaction: t ? t.interaction : null,
    follows: t ? t.follows : null,
    newThisRun: acc.newThisRun || null,
    incomingLikes7d: count7("likes"),
    newFollowers7d: count7("followers"),
    trend: (acc.history || []).map((h) => h.fans).filter((v) => v != null).slice(-12),
    lastReadAt: acc.lastReadAt || (t && t.t) || 0,
  };
}

// =====================================================================
// TARGETS (采集用户 — harvested leads)
// gatherComments + readUser already read everything; we persist the passing targets here
// so the operator can recall/export them. Store: hs_targets = Target[] (capped). A Target
// is deduped/merged by userId (newer fields overwrite; earliest capturedAt kept). Shape is
// the FROZEN contract panel.js consumes:
//   { userId, nickname, content, likeCount, replyCount, followers, following, likes,
//     gender, ipLocation, profileUrl, group, mode, sourceNote, capturedAt }
// =====================================================================
const TARGETS_CAP = 2000;
async function loadTargets() {
  const c = await chrome.storage.local.get("hs_targets");
  return Array.isArray(c.hs_targets) ? c.hs_targets : [];
}
async function saveTargets(arr) {
  await chrome.storage.local.set({ hs_targets: (Array.isArray(arr) ? arr : []).slice(-TARGETS_CAP) });
}
// upsertTarget — insert or merge by userId. Newer non-null fields overwrite; the EARLIEST
// capturedAt is preserved (first sighting). Targets without a userId are dropped (can't dedup).
async function upsertTarget(t) {
  if (!t || t.userId == null || t.userId === "") return null;
  const arr = await loadTargets();
  const uid = String(t.userId);
  const idx = arr.findIndex((x) => String(x.userId) === uid);
  if (idx === -1) {
    arr.push({ ...t, userId: uid, capturedAt: t.capturedAt || Date.now() });
  } else {
    const prev = arr[idx];
    const merged = { ...prev };
    for (const [k, v] of Object.entries(t)) {
      if (v != null && v !== "") merged[k] = v; // newer non-empty fields win
    }
    merged.userId = uid;
    merged.capturedAt = prev.capturedAt || t.capturedAt || Date.now(); // keep earliest
    arr[idx] = merged;
  }
  await saveTargets(arr);
  return arr.length;
}
// csvCell — quote/escape one CSV field per RFC-4180 (wrap in quotes, double internal quotes).
function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// exportTargets — write hs_targets as a CSV download. MV3 SW has no Blob URL, so we encode
// a data: URL (same pattern as exportLog). Returns the row count written.
async function exportTargets() {
  const arr = await loadTargets();
  const cols = [
    "userId", "nickname", "content", "likeCount", "replyCount", "followers", "following",
    "likes", "gender", "ipLocation", "profileUrl", "group", "mode", "sourceNote", "capturedAt",
  ];
  const lines = [cols.join(",")];
  for (const t of arr) {
    lines.push(cols.map((c) => csvCell(c === "capturedAt" && t[c] ? new Date(t[c]).toISOString() : t[c])).join(","));
  }
  const body = lines.join("\n") + "\n";
  const url = "data:text/csv;charset=utf-8," + encodeURIComponent(body);
  await chrome.downloads.download({ url, filename: "hs-portal/targets.csv", conflictAction: "overwrite", saveAs: false });
  return arr.length;
}

// =====================================================================
// SEEN MEMORY (cross-session dedup — Redaily's LOCAL processedNotes/xhsUsers)
// Redaily kept a local IndexedDB (Dexie "xhs-yhq") of processed notes and seen users so a
// workflow never re-opens the same post or re-checks the same person across runs
// (explore/profile → isNoteProcessed; comments → isCommentProcessed; xhsUsers table). It was
// LOCAL, never cloud — re-added here (the cloud-strip dropped it on a misread). Two id→ts maps
// in chrome.storage.local:
//   hs_seen_notes : { [noteId]: ts }  — notes we OPENED + browsed (discovery + profile)
//   hs_seen_users : { [userId]: ts }  — profiles we VISITED or users we FOLLOWED
// Dedup is whole-entity (stricter than Redaily's per-action keying): once seen, never touched
// again. The user key is the /user/profile/<id> PATH id — stable + readable PRE-click from
// gather results and profile seeds (NOT readUser's redId, which differs and needs a nav).
// comment_section SEED notes are intentionally NOT deduped (re-reading a seed harvests NEW
// commenters; only the commenters themselves are deduped).
// =====================================================================
const SEEN_NOTES_CAP = 4000;
const SEEN_USERS_CAP = 4000;

async function loadSeen(key) {
  const c = await chrome.storage.local.get(key);
  return c[key] && typeof c[key] === "object" ? c[key] : {};
}
// markSeen — stamp ids into a seen map with the current ts, evicting the oldest over cap.
// Sequential within the loop (awaited), so the load→mutate→save has no racing writer.
async function markSeen(key, ids, cap) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter((x) => x != null && x !== "").map(String);
  if (!list.length) return;
  const m = await loadSeen(key);
  const now = Date.now();
  for (const id of list) m[id] = now;
  const keys = Object.keys(m);
  if (keys.length > cap) {
    keys.sort((a, b) => m[a] - m[b]); // oldest first
    for (const k of keys.slice(0, keys.length - cap)) delete m[k];
  }
  await chrome.storage.local.set({ [key]: m });
}
const markNotesSeen = (ids) => markSeen("hs_seen_notes", ids, SEEN_NOTES_CAP);
const markUsersSeen = (ids) => markSeen("hs_seen_users", ids, SEEN_USERS_CAP);
async function seenNoteIds() {
  return Object.keys(await loadSeen("hs_seen_notes"));
}
async function isUserSeen(id) {
  if (id == null || id === "") return false;
  const m = await loadSeen("hs_seen_users");
  return Object.prototype.hasOwnProperty.call(m, String(id));
}
// userIdFromUrl — pull the stable /user/profile/<id> path id from a profile URL (the dedup
// key for both profile seeds and commenter visits). null when the URL has no profile segment.
function userIdFromUrl(url) {
  const m = String(url || "").match(/user\/profile\/([0-9a-zA-Z]+)/);
  return m ? m[1] : null;
}
// commenterKey — a commenter's stable dedup id: prefer the profile-URL path id, else a
// real gather userId (data-user-id), but never the "idx_"/"hs-cmt-" positional fallbacks.
function commenterKey(c) {
  return userIdFromUrl(c && c.profileUrl) || (c && c.userId && !/^(idx_|hs-cmt)/.test(String(c.userId)) ? String(c.userId) : null);
}
// realUserId — a target/commenter's stable, navigable user id (profile-URL path id preferred,
// else a real data-user-id, never an "idx_/hs-cmt" positional fallback). The dedup + visit key.
function realUserId(t) {
  return userIdFromUrl(t && t.profileUrl) || (t && t.userId && !/^(idx_|hs-cmt)/.test(String(t.userId)) ? String(t.userId) : null);
}
const XHS_ORIGIN = "https://www.xiaohongshu.com";
// absUrl — make a possibly-relative XHS href absolute so chrome.tabs.update can navigate it.
function absUrl(u) {
  const s = String(u || "");
  if (/^https?:\/\//.test(s)) return s;
  if (s.startsWith("/")) return XHS_ORIGIN + s;
  return s;
}

// =====================================================================
// SELF-FEEDING LOOP — auto-sourced seeds (the campaign runs with zero pasting)
// discovery browses the niche feed → nethook PASSIVELY captures those scored notes into
// hs_hot_notes (the Content Studio store; see recordHotNotes below). comment_section (auto)
// reads the top hot notes and harvests their commenters into hs_targets WITHOUT visiting
// profiles (cheap, wide). profile (auto) then drains hs_targets: it visits the un-visited
// leads, follows + engages them, and marks them seen. The pool fills from one side and
// drains from the other — forever, on the staggered schedule, no operator clicks.
//
// We REUSE the existing hs_hot_notes = { scannedAt, notes:HotNote[] } store (already scored
// + tokenized from the page's own /homefeed + /search traffic), so a comment seed URL is
// built from the note's captured xsec_token — the only reliable way past XHS's deep-link sec
// gate. A "used" map (hs_seed_notes_used) rotates which notes we harvest so it isn't always
// the same top few; a stale token just sec-gates → checkRisk skips that seed (graceful).
// =====================================================================
// hotNoteSeedUrl — build the openable /explore/<id> URL from a captured hot note (same
// pattern Content Studio uses); the xsec_token is what clears the sec gate.
function hotNoteSeedUrl(n) {
  return XHS_ORIGIN + "/explore/" + n.noteId + (n.xsecToken ? "?xsec_token=" + encodeURIComponent(n.xsecToken) + "&xsec_source=pc_feed" : "");
}
// pickHotNoteSeeds — choose up to `limit` captured hot notes for a comment_section harvest:
// least-recently-USED first (rotate the catalogue), highest engagement score as the tiebreak.
// Stamps the chosen ids in hs_seed_notes_used so the next run moves on. Returns seed URLs.
async function pickHotNoteSeeds(limit) {
  const c = await chrome.storage.local.get(["hs_hot_notes", "hs_seed_notes_used"]);
  const store = c.hs_hot_notes && Array.isArray(c.hs_hot_notes.notes) ? c.hs_hot_notes : { notes: [] };
  const used = c.hs_seed_notes_used && typeof c.hs_seed_notes_used === "object" ? c.hs_seed_notes_used : {};
  const notes = store.notes.filter((n) => n && n.noteId);
  if (!notes.length) return [];
  notes.sort((a, b) => (used[a.noteId] || 0) - (used[b.noteId] || 0) || (b.score || 0) - (a.score || 0));
  const pick = notes.slice(0, Math.max(1, limit));
  const now = Date.now();
  for (const n of pick) used[n.noteId] = now;
  const keys = Object.keys(used); // bound the used map
  if (keys.length > 500) {
    keys.sort((a, b) => used[a] - used[b]);
    for (const k of keys.slice(0, keys.length - 500)) delete used[k];
  }
  await chrome.storage.local.set({ hs_seed_notes_used: used });
  return pick.map(hotNoteSeedUrl);
}
// hotNotesCount — how many scored notes are queued for the harvester (pipeline tile readout).
async function hotNotesCount() {
  const c = await chrome.storage.local.get("hs_hot_notes");
  return c.hs_hot_notes && Array.isArray(c.hs_hot_notes.notes) ? c.hs_hot_notes.notes.length : 0;
}
// pickProfileSeeds — drain the lead pool: accumulated targets that have a navigable profile,
// have NOT been visited yet (not in hs_seen_users), and pass the plan's filter. Oldest-first
// (FIFO) so the backlog is worked through fairly and nobody waits forever. Returns profile URLs.
async function pickProfileSeeds(plan, limit) {
  const targets = await loadTargets();
  const seen = await loadSeen("hs_seen_users");
  const cands = [];
  for (const t of targets) {
    const uid = realUserId(t);
    if (!uid) continue;
    if (Object.prototype.hasOwnProperty.call(seen, uid)) continue; // already visited/followed
    if (!PLAN.matchTarget(t, plan.targetFilter)) continue;
    const url = t.profileUrl ? absUrl(t.profileUrl) : XHS_ORIGIN + "/user/profile/" + uid;
    cands.push({ url, capturedAt: t.capturedAt || 0 });
  }
  cands.sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0)); // FIFO — oldest unvisited first
  return cands.slice(0, Math.max(1, limit)).map((c) => c.url);
}
// resolveSeeds — the single runtime work-list resolver. Manual/keyword plans use their own
// seeds; an "auto" plan self-sources from accumulated state. Discovery always uses its
// keyword seeds (it does its own search). Returns the array the mode loop iterates.
async function resolveSeeds(plan) {
  if (plan.mode === PLAN.MODES.DISCOVERY) return plan.seeds || [];
  const auto = plan.seedSource === PLAN.SEED_SOURCE.AUTO || !(plan.seeds && plan.seeds.length);
  if (!auto) return plan.seeds || [];
  const c = await chrome.storage.local.get("hs_config");
  const as = (c.hs_config && c.hs_config.autoSeed) || DEFAULT_CONFIG.autoSeed;
  if (plan.mode === PLAN.MODES.PROFILE) return pickProfileSeeds(plan, as.profileVisitsPerRun);
  if (plan.mode === PLAN.MODES.COMMENT_SECTION) return pickHotNoteSeeds(as.commentNotesPerRun);
  return [];
}

// =====================================================================
// SESSION ORCHESTRATOR
// The loop lives HERE (not in the content script) so it can navigate by
// URL — which reloads the content script — and survive. The content
// engine exposes atomic one-shot ops; the background drives them, paces
// via the content `sleep` op (an open message port keeps the SW alive),
// and gates the capped mutations through the governor.
// =====================================================================

// Module state for the running session. SESSION.stop is the in-memory
// kill switch; gov.session.running is the persisted one (the popup polls it).
const SESSION = { stop: false, running: false, windowTabId: null, windowId: null, probed: false };

// Push a runner event onto the live log the popup reads. `url` (optional) records the
// page the event happened on — the operator asked logs to capture where we were.
function event(line, level, url) {
  pushEvent({ t: Date.now(), level: level || "info", line, url: url || undefined });
}

// waitTabLoaded — resolve true once the tab reports status==="complete"
// (catches the already-complete case too), false on timeout. Always
// detaches the listener so we never leak across navigations.
function waitTabLoaded(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve(val);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") finish(true);
    };
    const timer = setTimeout(() => finish(false), timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
    // Already complete? (navigation may have settled before we attached.)
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return; // tab gone — let timeout handle it
      if (tab && tab.status === "complete") finish(true);
    });
  });
}

// contentRPC — sendMessage to the content engine with retries. After a URL
// navigation the content script is re-injecting, so a throw is expected;
// back off and retry. Returns {ok:false,error} if it never comes back.
async function contentRPC(tabId, action, args, retries = 3) {
  let lastErr = "unreachable";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: "hs:action", action, args: args || {} });
    } catch (e) {
      lastErr = String((e && e.message) || e);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 600));
    }
  }
  return { ok: false, error: lastErr };
}

// stopped — true if the operator asked to stop (in-memory or persisted).
async function stopped() {
  if (SESSION.stop) return true;
  const s = await loadGov();
  return !s.session.running;
}

// tabUrl — current URL of the driven tab (works even after a sec/404 bounce).
async function tabUrl(tabId) {
  try {
    const t = await chrome.tabs.get(tabId);
    return (t && t.url) || "";
  } catch {
    return "";
  }
}

// SEC_RE — XHS's risk gate: a flagged/unavailable note is bounced to a /404/sec_… page
// with error_code=300031 (and often a verifyMsg param). The strongest live risk signal.
const SEC_RE = /\/404(\?|$|\/)|error_code=300031|\/sec_|[?&]verifyMsg=/;

// checkRisk — combined URL-level (background reads the tab URL even after a bounce, when
// the content script can't) + DOM-level (content engine) probe. Returns a signal or null.
async function checkRisk(tabId) {
  const url = await tabUrl(tabId);
  if (SEC_RE.test(url)) return "404/sec gate: " + url.slice(0, 140);
  const r = await contentRPC(tabId, "detectRisk");
  return (r && r.risk) || null;
}

// onRisk — uniform response to a detected signal: backoff + log (with URL) + export.
async function onRisk(signal, tabId) {
  const s = GOV.applyRisk(await loadGov(), signal, Date.now());
  await saveGov(s);
  event("RISK: " + signal, "warn", await tabUrl(tabId));
  await exportLog("risk");
}

// pill — best-effort status pill on the driven tab (FROZEN CONTRACT A, engine `showPill`).
// Never throws into the loop; a missing/reloading content script is a no-op.
async function pill(tabId, text, level) {
  try {
    await contentRPC(tabId, "showPill", { text, level: level || "info" });
  } catch {}
}

// setStage — single place that updates session progress + currentAction (FROZEN CONTRACT B)
// AND pushes the matching pill. saveGov so the read-only status poll sees it. `note` 1-based;
// pass null to leave progress untouched and only change the current action.
async function setStage(tabId, note, total, action) {
  const s = await loadGov();
  if (note != null) s.session.progress = { note, total: total ?? s.session.progress?.total ?? 0 };
  if (action) s.session.currentAction = action;
  await saveGov(s);
  const p = s.session.progress || {};
  await pill(
    tabId,
    (s.session.dryRun ? "DRY · " : "") + (p.total ? `note ${p.note}/${p.total} · ` : "") + (action || ""),
    action === "risk" ? "risk" : s.session.dryRun ? "dry" : "info"
  );
}

// openXHS — Redaily's exact entry point: open a DEDICATED 1024×768 popup window warmed on
// the /explore feed (with a cache-buster), wait for load, return its tab id. All session
// navigation then happens INSIDE this window. A cold tabs.update of a foreign tab straight
// to a deep URL (/search_result, /explore/<id>) is sec-gated to /404; this warm-then-
// navigate-inside pattern is not. (bg bundle: openXHS → windows.create → tabs.update.)
async function openXHS() {
  const url = "https://www.xiaohongshu.com/explore?_t=" + Date.now();
  // A NORMAL separate window (NOT type:"popup"): a popup window can't hold extra tabs, so the
  // aux tabs we open for commenter-profile visits would spill into the operator's MAIN Chrome
  // window ("opening on my profile in main chrome"). A normal window has a tab strip and keeps
  // every aux tab contained. focused:false → it opens in the BACKGROUND and never steals focus
  // or blocks normal browsing (matches Redaily's focused:!1).
  const w = await chrome.windows.create({ url, type: "normal", width: 1024, height: 768, focused: false });
  const tabId = w && w.tabs && w.tabs[0] && w.tabs[0].id;
  if (!tabId) throw new Error("could not open XHS automation window");
  // Flag this tab as the automation window BEFORE it finishes loading, so panel.js
  // (auto-show, fires at document_idle) reliably sees `isAutomationWindow` and stays
  // out of the bot's working window — the status pill reports there instead.
  SESSION.windowTabId = tabId;
  SESSION.windowId = (w && w.id != null) ? w.id : null; // so aux tabs (commenter profiles) open INSIDE this window
  await waitTabLoaded(tabId);
  event("automation window opened — windowId " + SESSION.windowId + " · tab " + tabId + " (separate background window)", "muted");
  return tabId;
}

// ensureWindow — reuse the automation window across runs if it's still an XHS tab (re-warm
// on /explore — in-window navigation is safe); otherwise open a fresh one. Keeps the
// warmed-window model faithful while avoiding window pile-up during testing.
async function ensureWindow() {
  if (SESSION.windowTabId) {
    try {
      const t = await chrome.tabs.get(SESSION.windowTabId);
      if (t && t.url && XHS_RE.test(new URL(t.url).hostname)) {
        SESSION.windowId = t.windowId; // re-cache the window id for aux-tab opening
        await chrome.tabs.update(t.id, { url: "https://www.xiaohongshu.com/explore?_t=" + Date.now() });
        await waitTabLoaded(t.id);
        return t.id;
      }
    } catch {
      /* tab gone — fall through and open a fresh one */
    }
  }
  const tabId = await openXHS();
  SESSION.windowTabId = tabId;
  return tabId;
}

// automationWindowId — the window id of the single spawned automation window, derived from
// the driven tab when not cached. Auxiliary visits (commenter profiles) open as background
// TABS inside this window so the bot never pops new windows or touches the operator's own
// browser — "everything runs in the one spawned window".
async function automationWindowId() {
  if (SESSION.windowId != null) return SESSION.windowId;
  if (SESSION.windowTabId != null) {
    try {
      const t = await chrome.tabs.get(SESSION.windowTabId);
      if (t) {
        SESSION.windowId = t.windowId;
        return t.windowId;
      }
    } catch {}
  }
  return null;
}

// governedAct — fire ONE capped mutation through the governor.
//   cap : governor counter key ("like"|"collect"|"follow"|"comment")
//   op  : content engine op name (e.g. "likeComment", "followUser")
// Records the action even in dry-run so caps visibly fill in the UI.
async function governedAct(tabId, plan, cap, op, args) {
  const state = GOV.clearRiskIfElapsed(await loadGov(), Date.now());
  const now = Date.now();
  if (!state.session.running || SESSION.stop) return { stop: true };

  const can = GOV.canAct(state, cap, await getEffectiveCaps(), now);
  if (!can.allow) {
    if (can.reason && can.reason.indexOf("session not running") === 0) return { stop: true };
    event("skip " + op + ": " + can.reason, "muted");
    return { skipped: true };
  }

  if (plan.dryRun) {
    event("[dry] would " + op, "dry");
  } else {
    const r = await contentRPC(tabId, op, args);
    event(op + ": " + (r.ok ? (r.detail || "ok") : "FAIL " + r.error), r.ok ? "ok" : "err");
  }

  // Record against caps (even dry-run) so the governor + UI reflect intent. On the SAME
  // loaded-state write: spend the per-action session budget and label the current action,
  // so the popup + pill see one consistent snapshot.
  const s2 = await loadGov();
  GOV.recordAction(s2, cap, now);
  s2.session.budget = s2.session.budget || {};
  s2.session.budget[cap] = s2.session.budget[cap] || { used: 0, max: 0 };
  s2.session.budget[cap].used += 1;
  s2.session.currentAction = cap;
  await saveGov(s2);
  return { ok: true };
}

// pickComment — choose a canned comment line; "" means "no text" (AI source
// has no local list, so it yields empty and the op no-ops on missing text).
function pickComment(cfg) {
  if (!cfg || cfg.source === "ai") return "";
  const l = cfg.comments || [];
  return l.length ? l[Math.floor(Math.random() * l.length)] : "";
}

// gatherGroup — the bucket name a harvested target is filed under. Operator-set group on
// the gather action wins, then the plan subject, then the mode (so there is always a label).
function gatherGroup(plan) {
  return (plan.actionMix.gather && plan.actionMix.gather.group) || plan.subject || plan.mode;
}

// commentText — resolve the comment string about to be sent. For the LIST source, pick a
// canned line. For the AI source, generate at runtime via the planner (FROZEN CONTRACT:
// PLANNER.generateComment(ctx, ai) → Promise<string>, "" on failure); on empty/failure we
// fall back to pickComment (which for ai yields "" → the comment op no-ops = safe). Never
// throws into the loop. `aiCfg` is the resolved aiConfig(stored.ai) (may be null for list).
async function commentText(cfg, ctx, aiCfg) {
  if (!cfg) return "";
  if (cfg.source !== "ai") return pickComment(cfg);
  try {
    const gen = await PLANNER.generateComment(ctx || {}, aiCfg);
    if (gen && gen.trim()) return gen.trim();
  } catch (e) {
    event("AI comment gen failed: " + String((e && e.message) || e), "muted");
  }
  return pickComment(cfg); // ai list-less fallback → "" → op no-ops
}

// computeProb — engagement probability for a cap. An explicit plan `probability`
// always wins. Otherwise: in DISCOVERY, spread the per-action session budget (count)
// across the planned notes (notesPerSession) so engagement is stochastic, not 100%
// per note. comment_section/profile are budget-only (prob 1) unless a probability is set.
function computeProb(plan, cap) {
  const cfg = plan.actionMix[cap] || {};
  if (cfg.probability != null) return Math.max(0, Math.min(1, +cfg.probability));
  if (plan.mode === PLAN.MODES.DISCOVERY) {
    const n = plan.pacing.notesPerSession || 1,
      c = +cfg.count || 0;
    return Math.max(0, Math.min(1, c / Math.max(1, n)));
  }
  return 1; // comment_section/profile: budget-only unless an explicit probability is set
}

// wantsAction — the plan-honoring engage gate (replaces bare `should`): the action
// fires only when it is enabled, has session budget remaining (count = per-action
// session budget), AND a probability roll passes (stochastic spread, anti-uniform).
// Reads the LIVE governor so the budget reflects what has already been spent this session.
async function wantsAction(plan, cap) {
  const cfg = plan.actionMix[cap] || {};
  if (!cfg.enabled) return false;
  const max = +cfg.count || 0;
  if (max <= 0) return false; // count 0 / unset => action off
  const s = await loadGov();
  const used = (s.session.budget && s.session.budget[cap] && s.session.budget[cap].used) || 0;
  if (used >= max) return false; // session budget spent
  return Math.random() < computeProb(plan, cap); // stochastic spread (anti-uniform)
}

// filterNeedsProfileFields — true when the target filter constrains a field only
// readable from the commenter's PROFILE (gender/followers/following). If so, the
// comment-section loop must visit the profile to enrich the target before filtering.
function filterNeedsProfileFields(f) {
  if (!f) return false;
  return (
    (f.gender && f.gender !== PLAN.GENDER.ANY) ||
    (f.followers && f.followers.op !== PLAN.NUM_OP.ANY) ||
    (f.following && f.following.op !== PLAN.NUM_OP.ANY)
  );
}

// ---- mode loops ------------------------------------------------------
// Read-only browsing (navigate/scroll/dwell/gather/readUser) RUNS even in
// dry-run; only the capped mutations are gated through governedAct.

// browseNote — Redaily's getNoteType → browseImage|browseVideo → browseContentAndComments.
// All three are self-contained read-only ops (run in dry-run). Replaces the old single
// dwell() in discovery and is the read step in profile-note browsing.
async function browseNote(tabId) {
  const nt = (await contentRPC(tabId, "getNoteType")).noteType;
  if (nt === "video") await contentRPC(tabId, "browseVideo");
  else await contentRPC(tabId, "browseImage"); // "normal" or unknown → image path
  await contentRPC(tabId, "browseContentAndComments");
}

// probeOnce — once per session, log which engage controls the engine resolves on the open
// note (DIAGNOSTIC for the "live run never succeeds" case). A "✗" = that selector matched
// nothing on the live DOM → the live action will FAIL → fix that SEL entry in engine.js.
// Runs in dry-run too, so the operator can verify selectors BEFORE a live run.
async function probeOnce(tabId) {
  if (SESSION.probed) return;
  SESSION.probed = true;
  try {
    const p = await contentRPC(tabId, "probeNote");
    const x = (p && p.probe) || {};
    const m = (b) => (b ? "✓" : "✗");
    event(
      "control probe · note " + (x.noteOpen ? "open" : "CLOSED") + " · like " + m(x.like) + " collect " + m(x.collect) +
        " follow " + m(x.follow) + " chat " + m(x.chat) + " editor " + m(x.editor),
      x.noteOpen && x.like && x.collect ? "muted" : "warn"
    );
  } catch (e) {}
}

// DISCOVERY — Redaily EXPLORE: open notes in the feed modal (no page reload),
// browse them (type-aware), engage (governed), close.
async function runDiscovery(tabId, plan, aiCfg) {
  const P = plan.pacing;
  const between = () => contentRPC(tabId, "sleep", { min: P.betweenActionsMs[0], max: P.betweenActionsMs[1] });

  // Discovery 养号 = browse a feed IN-SPA, then read its cover <img>s and click them to
  // open notes as modals — no navigation, so no /404 sec gate. When the plan carries
  // keyword seeds, run Redaily's SOFT in-SPA search first (engine `search` types into the
  // in-feed AI search box and verifies location.pathname.includes("search_result") — this
  // is NOT the cold deep-URL navigation that XHS sec-gates). If search succeeds and isn't
  // risk-bounced, the openNextNote loop reads the /search_result feed; otherwise we log and
  // fall back to the home /explore feed. NEVER hard-fail the session on search failure.
  if (plan.seeds && plan.seeds.length) {
    const keyword = plan.seeds[0];
    event("search keyword: " + keyword, "muted", await tabUrl(tabId));
    await setStage(tabId, null, null, "searching");
    const sr = await contentRPC(tabId, "search", { keyword });
    await contentRPC(tabId, "sleep", { min: 1200, max: 2200 }); // let the search_result feed settle
    const sRisk = await checkRisk(tabId);
    if (sRisk) {
      await onRisk(sRisk, tabId);
      return; // a risk bounce during search is a real signal — stop, don't browse on
    }
    if (sr && sr.ok) {
      event("search ok — browsing search_result feed for '" + keyword + "'", "info", await tabUrl(tabId));
    } else {
      event("search unavailable — falling back to home feed (" + ((sr && sr.error) || "no result") + ")", "warn", await tabUrl(tabId));
    }
  }

  // Seed the in-session visited list with notes seen in PRIOR runs so openNextNote skips
  // them at the candidate stage (pre-click) — cross-session dedup, no engine change needed.
  const visited = await seenNoteIds();
  for (let i = 0; i < plan.pacing.notesPerSession; i++) {
    if (await stopped()) break;

    let o = await contentRPC(tabId, "openNextNote", { visited });
    if (!o.ok) {
      // A failed open is either a thin feed OR a risk bounce (the card click sent us to
      // the /404/sec gate). Distinguish them before deciding to retry vs. stop.
      const rb = await checkRisk(tabId);
      if (rb) {
        await onRisk(rb, tabId);
        break;
      }
      await contentRPC(tabId, "scroll", { steps: 2 });
      const o2 = await contentRPC(tabId, "openNextNote", { visited });
      if (!o2.ok) {
        const rb2 = await checkRisk(tabId);
        if (rb2) {
          await onRisk(rb2, tabId);
          break;
        }
        event("feed exhausted", "info", await tabUrl(tabId));
        break;
      }
      Object.assign(o, o2);
    }
    // Record EVERY stable key for this note so the random picker never reopens it (noteId is
    // robust; cover src can lazy-change, so push both + the chosen key).
    if (o.noteId) visited.push(o.noteId);
    if (o.cover) visited.push(o.cover);
    if (o.key && o.key !== o.noteId && o.key !== o.cover) visited.push(o.key);
    await markNotesSeen(o.noteId); // persist: never re-open this note in a future run
    // (Discovery's feed/search traffic is captured PASSIVELY by nethook → hs_hot_notes, which
    // is what an auto comment_section run later harvests — no explicit recording needed here.)
    event("— note " + (i + 1) + "/" + plan.pacing.notesPerSession + " (" + (o.noteId || "?") + ")", "muted", await tabUrl(tabId));
    await setStage(tabId, i + 1, plan.pacing.notesPerSession, "browsing");

    const risk = await checkRisk(tabId);
    if (risk) {
      await setStage(tabId, null, null, "risk");
      await onRisk(risk, tabId);
      break;
    }

    // Redaily: getNoteType → browseImage|browseVideo → browseContentAndComments.
    await browseNote(tabId);
    // dwellMs — the operator's extra reading linger on top of browseNote's realistic read.
    await contentRPC(tabId, "sleep", { min: plan.pacing.dwellMs[0], max: plan.pacing.dwellMs[1] });

    let noteInfo = null; // cache getNoteInfo (one read per note) for AI comment context
    const getInfoOnce = async () => {
      if (noteInfo == null) noteInfo = (await contentRPC(tabId, "getNoteInfo")) || {};
      return noteInfo;
    };

    await probeOnce(tabId); // once per session: log engage-control presence (selector-drift diag)
    for (const a of ["like", "collect", "follow", "comment"]) {
      if (await stopped()) break;
      const cfg = plan.actionMix[a];
      if (!(await wantsAction(plan, a))) continue;
      await setStage(tabId, null, null, a);
      let args = {};
      if (a === "comment") {
        const info = await getInfoOnce();
        const text = await commentText(cfg, { subject: plan.subject, noteTitle: info.title, noteDesc: info.desc, style: cfg.emoji ? "emoji" : "" }, aiCfg);
        args = { text, submit: !!cfg.submit };
      }
      const r = await governedAct(tabId, plan, a, a, args);
      if (r.stop) {
        SESSION.stop = true;
        break;
      }
      await between();
    }

    await contentRPC(tabId, "closeNote");
    await between();
  }
}

// visitCommenterProfile — enrich a commenter from their profile. Opens the profile as a
// BACKGROUND TAB inside the one spawned automation window (active:false), reads the user
// (gender/followers/following/likes), performs the governed owner-follow + persists a gather
// if the enriched target passes the filter, then closes that tab. The seed note stays loaded
// in the main automation tab, so likeComment/replyComment still work afterward. Everything
// runs in the single spawned window — never a new window, never the operator's own tab.
// (Redaily used a separate window; we keep its read/follow/gather sequence but in-window.)
async function visitCommenterProfile(c, plan, sourceNote) {
  const winId = await automationWindowId();
  let pTab = null;
  try {
    if (winId != null) {
      const t = await chrome.tabs.create({ windowId: winId, url: c.profileUrl, active: false });
      pTab = t && t.id;
    } else {
      // No automation window resolvable (shouldn't happen mid-session) → defensive fallback.
      const w = await chrome.windows.create({ url: c.profileUrl, type: "popup", width: 1024, height: 768, focused: false });
      pTab = w && w.tabs && w.tabs[0] && w.tabs[0].id;
    }
  } catch (e) {
    pTab = null;
  }
  if (!pTab) return c;
  // PROOF (instrumentation): log where the aux tab actually landed — its windowId must equal
  // the automation window. If it ever differs, the visit spilled into another window.
  try {
    const tt = await chrome.tabs.get(pTab);
    const where = tt && tt.windowId === winId ? "automation window" : "OTHER WINDOW " + (tt && tt.windowId);
    event("profile aux tab " + pTab + " → " + where + " (automation " + winId + ")", tt && tt.windowId === winId ? "muted" : "warn");
  } catch {}
  // Closing the only tab also closes a fallback window, so tabs.remove covers both cases.
  const closeAux = async () => {
    try {
      await chrome.tabs.remove(pTab);
    } catch {}
  };
  await waitTabLoaded(pTab);
  await contentRPC(pTab, "sleep", { min: 1500, max: 3000 });

  const rb = await checkRisk(pTab);
  if (rb) {
    await onRisk(rb, pTab);
    await closeAux();
    return c;
  }

  const u = (await contentRPC(pTab, "readUser")).user || {};
  const merged = {
    ...c,
    nickname: u.name ?? c.nickname,
    gender: u.gender ?? c.gender,
    followers: u.followers ?? c.followers,
    following: u.following ?? c.following,
    likes: u.likes ?? c.likes,
    ipLocation: u.ipLocation ?? c.ipLocation,
  };

  if (PLAN.matchTarget(merged, plan.targetFilter) && (await wantsAction(plan, "follow"))) {
    await governedAct(pTab, plan, "follow", "followUserProfile", {});
  }
  if (plan.actionMix.gather && plan.actionMix.gather.enabled && PLAN.matchTarget(merged, plan.targetFilter)) {
    await upsertTarget({
      userId: merged.userId,
      nickname: merged.nickname || null,
      content: merged.content || null,
      likeCount: merged.likeCount != null ? merged.likeCount : null,
      replyCount: merged.replyCount != null ? merged.replyCount : null,
      followers: merged.followers != null ? merged.followers : null,
      following: merged.following != null ? merged.following : null,
      likes: merged.likes != null ? merged.likes : null,
      gender: merged.gender || null,
      ipLocation: merged.ipLocation || null,
      profileUrl: merged.profileUrl || null,
      group: gatherGroup(plan),
      mode: plan.mode,
      sourceNote: sourceNote || null,
      capturedAt: Date.now(),
    });
    event("gather user " + (merged.userId || "?"), "muted");
  }

  await closeAux();
  return merged;
}

// COMMENT_SECTION — Redaily COMMENTS: for each seed note, read context, paginate its
// comments, and for each fresh commenter — optionally visit their profile in a separate
// window to enrich/follow/gather — like + reply (governed) if they pass the filter.
async function runCommentSection(tabId, plan, aiCfg) {
  const P = plan.pacing;
  const between = () => contentRPC(tabId, "sleep", { min: P.betweenActionsMs[0], max: P.betweenActionsMs[1] });

  // Seeds: pasted note URLs (manual) OR, for a self-feeding plan, the freshest notes that
  // discovery surfaced (auto). An empty auto pool just means discovery hasn't run yet.
  const seeds = await resolveSeeds(plan);
  if (!seeds.length) {
    event(
      plan.seedSource === PLAN.SEED_SOURCE.AUTO
        ? "no discovered notes yet — run the discovery plan first (it surfaces the notes this harvests)"
        : "no seed notes — paste a note URL or use a discovery plan to feed this one",
      "warn"
    );
    return;
  }

  for (const seed of seeds) {
    if (await stopped()) break;
    event("open seed: " + seed, "muted", seed);
    await chrome.tabs.update(tabId, { url: seed });
    await waitTabLoaded(tabId);
    await contentRPC(tabId, "sleep", { min: 1500, max: 3000 });
    const rb = await checkRisk(tabId);
    if (rb) {
      await setStage(tabId, null, null, "risk");
      await onRisk(rb, tabId);
      break;
    }

    // Read-only note context (Redaily getNoteInfo → getNoteType).
    const info = await contentRPC(tabId, "getNoteInfo");
    if (info && info.ok) event("note: " + (info.title || "(untitled)"), "muted", seed);
    await contentRPC(tabId, "getNoteType");

    // Paginate comments Redaily-style: loadComments + gatherComments until no NEW
    // comments arrive (cap 5 rounds), deduping by commentId across rounds.
    const seen = new Set();
    let outOfLoop = false;
    for (let round = 0; round < 5 && !outOfLoop; round++) {
      if (await stopped()) break;
      await contentRPC(tabId, "loadComments", {});
      const g = await contentRPC(tabId, "gatherComments");
      const all = (g && g.comments) || [];
      const fresh = all.filter((c) => c.commentId && !seen.has(c.commentId));
      if (!fresh.length) break;
      for (const c of fresh) seen.add(c.commentId);
      event("round " + (round + 1) + ": " + fresh.length + " new comments", "muted");

      for (const c of fresh) {
        if (await stopped()) {
          outOfLoop = true;
          break;
        }

        // Cross-session dedup: a commenter we already visited/followed in a prior run is
        // skipped before any profile visit or engagement (the user's "don't re-check people
        // we've already added/followed"). cuid is null for ID-less rows → never deduped.
        const cuid = commenterKey(c);
        if (cuid && (await isUserSeen(cuid))) {
          event("skip commenter (already seen): " + cuid, "muted");
          continue;
        }

        // Does the commenter's PROFILE need to be opened? Only when we'll FOLLOW them here,
        // or the filter constrains a profile-only field. Gather does NOT force a visit — the
        // harvester records commenters cheaply (from the comment row), leaving their profiles
        // UNVISITED so the profile plan can drain them later. This decoupling is what lets the
        // lead pool accumulate; visiting+following here would mark everyone seen and starve it.
        const needsProfile =
          (plan.actionMix.follow && plan.actionMix.follow.enabled) ||
          filterNeedsProfileFields(plan.targetFilter);

        let didEngage = false; // mark seen only when we actually touch them (visit/like/reply)
        if (needsProfile && c.profileUrl) {
          const merged = await visitCommenterProfile(c, plan, seed);
          if (cuid) await markUsersSeen(cuid); // physically opened their profile — don't re-check next run
          didEngage = true;
          if (!PLAN.matchTarget(merged, plan.targetFilter)) {
            await between();
            continue;
          }
        } else if (!PLAN.matchTarget(c, plan.targetFilter)) {
          await between();
          continue;
        }

        if (await wantsAction(plan, "like")) {
          await setStage(tabId, null, null, "like");
          const r = await governedAct(tabId, plan, "like", "likeComment", { commentId: c.commentId });
          if (r.stop) {
            SESSION.stop = true;
            outOfLoop = true;
            break;
          }
          if (r.ok) didEngage = true;
        }
        if (await wantsAction(plan, "comment")) {
          await setStage(tabId, null, null, "comment");
          const cc = plan.actionMix.comment;
          // Reply CONTEXT-aware: note title/desc + the commenter's own text (so AI replies
          // to THEM). commentText falls back to the canned list / "" (no-burn) on failure.
          const text = await commentText(
            cc,
            { subject: plan.subject, noteTitle: info && info.title, noteDesc: info && info.desc, commentText: c.content, style: cc.emoji ? "emoji" : "" },
            aiCfg
          );
          const r = await governedAct(tabId, plan, "comment", "replyComment", {
            commentId: c.commentId,
            text,
            submit: !!cc.submit,
          });
          if (r.stop) {
            SESSION.stop = true;
            outOfLoop = true;
            break;
          }
          if (r.ok) didEngage = true;
        }
        // gather for the in-place (non-profile) path; the profile path already persisted.
        if (!needsProfile && plan.actionMix.gather && plan.actionMix.gather.enabled) {
          await upsertTarget({
            userId: c.userId,
            nickname: c.nickname || null,
            content: c.content || null,
            likeCount: c.likeCount != null ? c.likeCount : null,
            replyCount: c.replyCount != null ? c.replyCount : null,
            followers: c.followers != null ? c.followers : null,
            following: c.following != null ? c.following : null,
            likes: c.likes != null ? c.likes : null,
            gender: c.gender || null,
            ipLocation: c.ipLocation || null,
            profileUrl: c.profileUrl || null,
            group: gatherGroup(plan),
            mode: plan.mode,
            sourceNote: seed || null,
            capturedAt: Date.now(),
          });
          event("harvest lead " + (c.userId || "?") + " (unvisited — queued for a profile visit)", "muted");
        }
        // Mark seen ONLY if we actually engaged (visited / liked / replied). A pure-harvest
        // commenter stays UNSEEN on purpose, so the profile plan can visit them later.
        if (cuid && didEngage) await markUsersSeen(cuid);
        await between();
      }
    }
  }
}

// PROFILE — Redaily PROFILE: for each (shuffled) profile seed, follow the OWNER, then
// browse their notes (open → governed author-follow → type-aware browse → engage → close).
// Does NOT pre-filter the owner — Redaily profile mode follows then browses.
async function runProfile(tabId, plan, aiCfg) {
  const P = plan.pacing;
  const between = () => contentRPC(tabId, "sleep", { min: P.betweenActionsMs[0], max: P.betweenActionsMs[1] });

  // Seeds: pasted profile URLs (manual) OR, for a self-feeding plan, the oldest un-visited
  // leads from the accumulated pool (auto) — the loop's drain side. An empty auto pool just
  // means the harvester hasn't filled it yet (comment_section runs earlier in the day).
  const resolved = await resolveSeeds(plan);
  if (!resolved.length) {
    event(
      plan.seedSource === PLAN.SEED_SOURCE.AUTO
        ? "no accumulated leads yet — the comment_section plan harvests them first (it's scheduled earlier)"
        : "no profile seeds — paste profile URLs or let the comment_section plan accumulate leads",
      "warn"
    );
    return;
  }
  // Fisher-Yates shuffle of a copy of the resolved seeds.
  const seeds = resolved.slice();
  for (let i = seeds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
  }

  for (const seed of seeds) {
    if (await stopped()) break;
    // Cross-session dedup: skip an owner we already visited/followed in a prior run BEFORE
    // navigating (the user's "don't re-check the profile of people we've already added").
    const ownerId = userIdFromUrl(seed);
    if (ownerId && (await isUserSeen(ownerId))) {
      event("skip profile (already visited): " + ownerId, "muted", seed);
      continue;
    }
    event("open profile: " + seed, "muted", seed);
    await chrome.tabs.update(tabId, { url: seed });
    await waitTabLoaded(tabId);
    await contentRPC(tabId, "sleep", { min: 1500, max: 3000 });
    const rb = await checkRisk(tabId);
    if (rb) {
      await setStage(tabId, null, null, "risk");
      await onRisk(rb, tabId);
      break;
    }

    // Read-only owner context (log the name).
    const u = await contentRPC(tabId, "readUser");
    const owner = (u && u.user) || {};
    event("profile owner: " + (owner.name || owner.userId || "?"), "muted", seed);

    // Persist the profile OWNER as a harvested lead (profile mode harvests the owner).
    if (plan.actionMix.gather && plan.actionMix.gather.enabled && (owner.userId != null && owner.userId !== "")) {
      await upsertTarget({
        userId: owner.userId,
        nickname: owner.name || null,
        content: null,
        likeCount: null,
        replyCount: null,
        followers: owner.followers != null ? owner.followers : null,
        following: owner.following != null ? owner.following : null,
        likes: owner.likes != null ? owner.likes : null,
        gender: owner.gender || null,
        ipLocation: owner.ipLocation || null,
        profileUrl: seed || null,
        group: gatherGroup(plan),
        mode: plan.mode,
        sourceNote: seed || null,
        capturedAt: Date.now(),
      });
      event("gather owner " + (owner.userId || "?"), "muted", seed);
    }

    // Follow the profile OWNER (governed).
    if (await wantsAction(plan, "follow")) {
      await setStage(tabId, null, null, "follow");
      const r = await governedAct(tabId, plan, "follow", "followUserProfile", {});
      if (r.stop) {
        SESSION.stop = true;
        break;
      }
    }
    if (ownerId) await markUsersSeen(ownerId); // visited this profile — don't re-check it next run

    // Browse the owner's notes: paginate getProfileNotes, dedup by noteId across rounds AND
    // against prior runs (seed the set with persisted seen-note ids → fresh filter skips them).
    let processed = 0;
    const seenNotes = new Set(await seenNoteIds());
    let outOfLoop = false;
    for (let round = 0; round < 6 && !outOfLoop; round++) {
      if (await stopped()) break;
      const notes = ((await contentRPC(tabId, "getProfileNotes")).notes) || [];
      const fresh = notes.filter((n) => n.noteId && !seenNotes.has(n.noteId));
      if (!fresh.length) break;
      for (const n of fresh) seenNotes.add(n.noteId);

      for (const n of fresh) {
        if (await stopped() || processed >= plan.pacing.notesPerSession) {
          outOfLoop = true;
          break;
        }
        const o = await contentRPC(tabId, "openProfileNote", { coverUrl: n.coverUrl, noteId: n.noteId });
        if (!o.ok) continue;
        await markNotesSeen(n.noteId); // persist: never re-open this note in a future run
        await setStage(tabId, processed + 1, plan.pacing.notesPerSession, "browsing");

        const risk = await checkRisk(tabId);
        if (risk) {
          await setStage(tabId, null, null, "risk");
          await onRisk(risk, tabId);
          outOfLoop = true;
          break;
        }

        // Author follow (idempotent — owner is usually the author; engine is no-op if already followed).
        if (await wantsAction(plan, "follow")) {
          await setStage(tabId, null, null, "follow");
          const r = await governedAct(tabId, plan, "follow", "followUser", {});
          if (r.stop) {
            SESSION.stop = true;
            outOfLoop = true;
            break;
          }
        }

        await browseNote(tabId);
        // dwellMs — the operator's extra reading linger on top of browseNote's realistic read.
        await contentRPC(tabId, "sleep", { min: plan.pacing.dwellMs[0], max: plan.pacing.dwellMs[1] });

        let noteInfo = null; // cache getNoteInfo (one read per note) for AI comment context
        const getInfoOnce = async () => {
          if (noteInfo == null) noteInfo = (await contentRPC(tabId, "getNoteInfo")) || {};
          return noteInfo;
        };

        await probeOnce(tabId); // once per session: log engage-control presence (selector-drift diag)
        for (const a of ["like", "collect", "comment"]) {
          if (await stopped()) break;
          const cfg = plan.actionMix[a];
          if (!(await wantsAction(plan, a))) continue;
          await setStage(tabId, null, null, a);
          let args = {};
          if (a === "comment") {
            const ninfo = await getInfoOnce();
            const text = await commentText(cfg, { subject: plan.subject, noteTitle: ninfo.title, noteDesc: ninfo.desc, style: cfg.emoji ? "emoji" : "" }, aiCfg);
            args = { text, submit: !!cfg.submit };
          }
          const r = await governedAct(tabId, plan, a, a, args);
          if (r.stop) {
            SESSION.stop = true;
            outOfLoop = true;
            break;
          }
          await between();
        }

        await contentRPC(tabId, "closeNote");
        processed++;
        await between();
      }
      if (processed >= plan.pacing.notesPerSession) break;
    }
  }
}

// startSession — the SINGLE entry point both hs:session:start (manual) and the alarm
// scheduler use to begin a run. Guards against a double-start, stamps the plan in the
// library (lastRunAt → sort order), initializes the FROZEN session state (governor +
// live progress/budget), then launches runSession DETACHED (long-running; never awaited).
// Returns {ok:true,summary} on launch or {ok:false,error} if a session is already running.
// `source` is just for the log line ("manual" | "scheduler").
async function startSession(rawPlan, source) {
  if (SESSION.running) return { ok: false, error: "A session is already running." };
  const plan = PLAN.normalizePlan(rawPlan);

  // Stamp the library so this run's plan is recallable (lastRunAt drives sort order).
  // Only touches hs_plans/hs_active_plan_id (and assigns plan.id when not yet in the library).
  {
    let { plans } = await loadPlans();
    let e = plan.id && plans.find((p) => p.id === plan.id);
    if (e) {
      e.lastRunAt = Date.now();
      plans = plans.map((p) => (p.id === e.id ? e : p));
      await savePlans(plans, e.id);
    } else {
      const r = await upsertPlan(plan, null, plan.source || "manual");
      r.entry.lastRunAt = Date.now();
      const pl = r.plans.map((p) => (p.id === r.entry.id ? r.entry : p));
      await savePlans(pl, r.entry.id);
      plan.id = r.entry.id;
    }
  }

  const state = await loadGov();
  state.session = {
    running: true,
    paused: false,
    startedAt: Date.now(),
    plan: { id: plan.id, mode: plan.mode, dryRun: plan.dryRun },
    notesVisited: 0,
    actionsTaken: 0,
    // ---- live progress surfaced to popup + pill (FROZEN CONTRACT B) ----
    mode: plan.mode,
    dryRun: !!plan.dryRun,
    progress: { note: 0, total: plan.pacing.notesPerSession || 0 },
    currentAction: "starting",
    budget: {
      like: { used: 0, max: +plan.actionMix.like.count || 0 },
      collect: { used: 0, max: +plan.actionMix.collect.count || 0 },
      follow: { used: 0, max: +plan.actionMix.follow.count || 0 },
      comment: { used: 0, max: +plan.actionMix.comment.count || 0 },
    },
  };
  await saveGov(state);
  // Fresh log per run, flip the kill switch off, mark running BEFORE launching.
  RECENT.length = 0;
  SESSIONLOG.length = 0;
  SESSION.stop = false;
  SESSION.running = true;
  SESSION.probed = false; // probe the engage controls once on the first note of this run
  event("session start (" + (source || "manual") + ") — " + PLAN.describePlan(plan), "info");
  runSession(plan); // DETACHED — runs long; must not be awaited
  return { ok: true, summary: PLAN.describePlan(plan) };
}

// =====================================================================
// AUTO-SCHEDULER (错峰 staggered per-plan runs via chrome.alarms)
// Faithful to Redaily's mechanism (static/background/index.js): an onAlarm listener whose
// handler splits the alarm name on "_" → [type, id]; for the workflow type it loads the
// workflow by id and starts the engine ("workflow"===t → manager.startEngine(workflow)).
// Redaily registers it via a small registrar u() that logs "Alarm listener registered" and
// creates the periodic version-check alarm on onInstalled. We mirror that exactly, layered
// onto OUR plan library + startSession: alarm name = "hs_plan_<plan.id>".
// =====================================================================
const PLAN_ALARM_PREFIX = "hs_plan_";

// FIRE_JITTER_MS — each armed alarm fires 0–14 min AFTER the stored timeOfDay, re-rolled
// on every (re)arm, so the account never acts at the exact same minute every day (the
// same anti-pattern reasoning as the governor's jittered pacing, applied to the clock).
const FIRE_JITTER_MS = 14 * 60 * 1000;

// jitterTimeOfDay("09:00") -> e.g. "09:11" — shift an AI-proposed time by ±18 min once at
// save, so even a template-y LLM answer lands as an organic-looking stored time.
function jitterTimeOfDay(tod) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(tod || "").trim());
  if (!m) return "";
  let mins = +m[1] * 60 + +m[2] + Math.round((Math.random() * 2 - 1) * 18);
  mins = ((mins % 1440) + 1440) % 1440;
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return hh + ":" + mm;
}

// nextOccurrence — the next Date (ms epoch) matching a schedule's "HH:MM" timeOfDay and
// weekdays[] (0=Sun..6=Sat; [] = every day), strictly AFTER `from`. Returns null if the
// schedule isn't runnable (disabled / no/invalid timeOfDay). Plain Date math (fine in the
// extension runtime). Scans up to 8 days ahead so weekday filters always resolve.
function nextOccurrence(schedule, from) {
  if (!schedule || !schedule.enabled) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(schedule.timeOfDay || "").trim());
  if (!m) return null;
  const hh = +m[1],
    mm = +m[2];
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const days = Array.isArray(schedule.weekdays) ? schedule.weekdays : [];
  const base = new Date(from);
  for (let i = 0; i <= 8; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, hh, mm, 0, 0);
    if (d.getTime() <= from) continue; // strictly future
    if (days.length && !days.includes(d.getDay())) continue; // weekday filter
    return d.getTime();
  }
  return null;
}

// clearPlanAlarms — remove all of OUR hs_plan_* alarms (leaves any other alarm, e.g. a
// future update-check, untouched). Best-effort; never throws.
async function clearPlanAlarms() {
  try {
    const all = await chrome.alarms.getAll();
    await Promise.all(all.filter((a) => a.name.startsWith(PLAN_ALARM_PREFIX)).map((a) => chrome.alarms.clear(a.name)));
  } catch (e) {
    event("clearPlanAlarms failed: " + String((e && e.message) || e), "muted");
  }
}

// syncSchedules — re-derive ALL plan alarms from the library: clear our hs_plan_* alarms,
// then for every plan with schedule.enabled create one alarm at its NEXT occurrence
// (chrome.alarms.create(name, { when })). Idempotent — safe to call on install, SW startup,
// and after any plan save. Returns the count armed. Defensive; never throws into the SW.
async function syncSchedules() {
  try {
    if (!chrome.alarms) return 0;
    await clearPlanAlarms();
    const { plans } = await loadPlans();
    const now = Date.now();
    let armed = 0;
    for (const p of plans) {
      const when = nextOccurrence(p.schedule, now);
      if (when == null) continue;
      try {
        await chrome.alarms.create(PLAN_ALARM_PREFIX + p.id, { when: when + Math.floor(Math.random() * FIRE_JITTER_MS) });
        armed++;
      } catch (e) {
        event("schedule arm failed for " + p.id + ": " + String((e && e.message) || e), "muted");
      }
    }
    if (armed) event("scheduler: armed " + armed + " plan alarm(s)", "muted");
    return armed;
  } catch (e) {
    event("syncSchedules failed: " + String((e && e.message) || e), "muted");
    return 0;
  }
}

// rescheduleOne — re-create a single plan's alarm at its next occurrence (called after a
// fire so the schedule repeats). Clears first so a now-disabled/edited plan doesn't linger.
async function rescheduleOne(plan) {
  try {
    const name = PLAN_ALARM_PREFIX + plan.id;
    await chrome.alarms.clear(name);
    let when = nextOccurrence(plan.schedule, Date.now());
    if (when != null) {
      when += Math.floor(Math.random() * FIRE_JITTER_MS);
      await chrome.alarms.create(name, { when });
    }
    return when;
  } catch (e) {
    event("rescheduleOne failed for " + plan.id + ": " + String((e && e.message) || e), "muted");
    return null;
  }
}

// onPlanAlarm — Redaily's alarm handler shape: split the name, dispatch by type. For a
// hs_plan_<id> alarm: load the plan from the library; if no session is running, start it via
// the SAME startSession path the message handler uses (respecting plan.dryRun); if a session
// IS running, skip this fire. Either way, recompute + set the NEXT occurrence so it repeats.
async function onPlanAlarm(alarm) {
  const name = (alarm && alarm.name) || "";
  if (!name.startsWith(PLAN_ALARM_PREFIX)) return; // not ours (e.g. a future update-check)
  const id = name.slice(PLAN_ALARM_PREFIX.length);
  try {
    const { plans } = await loadPlans();
    const plan = plans.find((p) => p.id === id);
    if (!plan) {
      event("scheduler: plan " + id + " gone — alarm dropped", "muted");
      return; // plan deleted; alarm already fired (one-shot), nothing to reschedule
    }
    if (!plan.schedule || !plan.schedule.enabled) {
      event("scheduler: plan " + id + " no longer scheduled — skipping", "muted");
      return;
    }
    if (SESSION.running) {
      event("scheduler: session busy — skipping plan " + id + ", rescheduling", "warn");
    } else {
      const r = await startSession(plan, "scheduler");
      if (r.ok) event("scheduler: started plan " + id + " — " + r.summary, "info");
      else event("scheduler: could not start plan " + id + ": " + r.error, "warn");
    }
    const nxt = await rescheduleOne(plan); // repeat at the next occurrence
    if (nxt != null) event("scheduler: plan " + id + " next run " + new Date(nxt).toLocaleString(), "muted");
  } catch (e) {
    event("scheduler: error handling alarm " + name + ": " + String((e && e.message) || e), "warn");
  }
}

// Register the alarm listener at SW startup (mirrors Redaily's u() registrar). The listener
// ignores non-hs_plan_ alarms, so any future periodic alarm (e.g. update-check) is unaffected.
if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(onPlanAlarm);
}
// SW (re)start also re-derives the alarm set — chrome.alarms persist, but re-syncing keeps
// them aligned with the current library (and re-arms after a long sleep). Best-effort.
syncSchedules();

// =====================================================================
// CONTENT STUDIO (trend radar + Viral-Copy remix + drafts)
// The portal's "see today's best notes → one-click remix" loop. Hot notes are captured
// PASSIVELY from the page's own signed feed traffic (nethook → hs:account:observed kind
// "feed") — the same blessed mechanism as account traction; we never sign our own feed fetch.
// A scan just opens a background XHS window and browses to GENERATE that traffic. Stores:
//   hs_hot_notes = { scannedAt, notes:HotNote[] }   (scored, capped, dedup by noteId)
//   hs_drafts    = Draft[]                            (remix outputs, capped)
// =====================================================================
const HOT_NOTES_CAP = 300;
const DRAFTS_CAP = 50;

// fmtCount — compact 万/亿 formatting for display strings (reasons + UI hints).
function fmtCount(n) {
  n = +n || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, "") + "亿";
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, "") + "万";
  return String(n);
}

// scoreHotNote — local relevance score (0–100) + human reasons ("为什么值得抄"). Weights
// follow the research: 收藏 is weighted heavily (收藏率 gates the 流量池), 评论 signals
// discussability (good for remix/截流). The feed payload carries no publish-age, so we rank
// by weighted engagement; XHS already recency-biases the recommend feed.
function scoreHotNote(n) {
  const likes = +n.likes || 0, collects = +n.collects || 0, comments = +n.comments || 0;
  const norm = (x) => Math.max(0, Math.min(1, Math.log10(x + 1) / 6)); // ~1e6 → 1
  const score = Math.round(100 * (0.45 * norm(likes) + 0.3 * norm(collects) + 0.2 * norm(comments) + 0.05 * (n.title ? 1 : 0)));
  const reasons = [];
  if (likes >= 1000) reasons.push("高赞 " + fmtCount(likes));
  const ratio = likes > 0 ? collects / likes : 0;
  if (collects >= 300 && ratio >= 0.15) reasons.push("收藏率高 (藏/赞 " + ratio.toFixed(2) + ")");
  if (comments >= 100) reasons.push("评论活跃 " + fmtCount(comments));
  if (n.title) reasons.push("标题清晰");
  if (!reasons.length) reasons.push("待评估");
  return { score, reasons };
}

// recordHotNotes — fold a batch of nethook-captured feed items into hs_hot_notes (parse the
// 万/亿 counts, score, dedup by noteId keeping the newest reading, keep last-known cover/title).
// Serialized via hotChain so concurrent feed messages don't drop writes (load→modify→save race).
let hotChain = Promise.resolve();
function recordHotNotes(source, notes) {
  hotChain = hotChain.then(async () => {
    try {
      if (!notes || !notes.length) return;
      const c = await chrome.storage.local.get("hs_hot_notes");
      const store = c.hs_hot_notes && Array.isArray(c.hs_hot_notes.notes) ? c.hs_hot_notes : { scannedAt: 0, notes: [] };
      const byId = new Map(store.notes.map((x) => [x.noteId, x]));
      for (const raw of notes) {
        if (!raw || !raw.noteId) continue;
        const prev = byId.get(String(raw.noteId)) || {};
        const n = {
          noteId: String(raw.noteId),
          xsecToken: raw.xsecToken || prev.xsecToken || "",
          type: raw.type === "video" ? "video" : "normal",
          title: raw.title || prev.title || "",
          coverUrl: raw.coverUrl || prev.coverUrl || "",
          authorName: raw.authorName || prev.authorName || "",
          authorId: raw.authorId || prev.authorId || "",
          likes: parseCountBg(raw.likes),
          collects: parseCountBg(raw.collects),
          comments: parseCountBg(raw.comments),
          shares: parseCountBg(raw.shares),
          source: source || raw.source || "homefeed",
          capturedAt: Date.now(),
        };
        byId.set(n.noteId, Object.assign(n, scoreHotNote(n)));
      }
      const arr = [...byId.values()].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, HOT_NOTES_CAP);
      await chrome.storage.local.set({ hs_hot_notes: { scannedAt: Date.now(), notes: arr } });
    } catch (e) {
      event("recordHotNotes failed: " + String((e && e.message) || e), "muted");
    }
  });
  return hotChain;
}

// scanHotNotes — open a background XHS window, browse the recommend feed (and optionally run a
// soft in-SPA search per keyword) to GENERATE signed feed traffic that nethook captures →
// recordHotNotes fills hs_hot_notes. Read-only (no mutations). Refuses while a 养号 session
// runs (don't fight the runner for a window). Returns the freshly-scored top notes.
async function scanHotNotes({ keywords } = {}) {
  if (SESSION.running) return { ok: false, error: "a 养号 session is running — scan after it finishes" };
  let winId = null, tabId = null;
  try {
    const w = await chrome.windows.create({ url: "https://www.xiaohongshu.com/explore?_t=" + Date.now(), type: "popup", width: 1100, height: 820, focused: false });
    winId = w && w.id;
    tabId = w && w.tabs && w.tabs[0] && w.tabs[0].id;
    if (!tabId) return { ok: false, error: "could not open scan window" };
    await waitTabLoaded(tabId);
    await contentRPC(tabId, "sleep", { min: 1600, max: 2600 }); // /homefeed fires on load
    const risk0 = await checkRisk(tabId);
    if (risk0) {
      await onRisk(risk0, tabId);
      return { ok: false, error: "risk during scan: " + risk0 };
    }
    // Scroll to page more of the recommend feed (each page = another captured /homefeed).
    for (let i = 0; i < 3; i++) {
      await contentRPC(tabId, "scroll", { steps: 2 });
      await contentRPC(tabId, "sleep", { min: 1400, max: 2400 });
    }
    // Optional: soft in-SPA keyword search (Redaily's gentle search — never a cold deep-URL nav).
    for (const kw of (keywords || []).filter(Boolean).slice(0, 3)) {
      const sr = await contentRPC(tabId, "search", { keyword: kw });
      await contentRPC(tabId, "sleep", { min: 1500, max: 2600 }); // /search/notes fires + is captured
      const rb = await checkRisk(tabId);
      if (rb) {
        await onRisk(rb, tabId);
        break;
      }
      if (sr && sr.ok) {
        for (let i = 0; i < 2; i++) {
          await contentRPC(tabId, "scroll", { steps: 2 });
          await contentRPC(tabId, "sleep", { min: 1300, max: 2200 });
        }
      }
    }
    await contentRPC(tabId, "sleep", { min: 800, max: 1400 }); // let the last responses land + record
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    if (winId != null) {
      try {
        await chrome.windows.remove(winId);
      } catch {}
    }
  }
  await hotChain; // flush any in-flight recordHotNotes writes before reading
  const c = await chrome.storage.local.get("hs_hot_notes");
  const store = c.hs_hot_notes && Array.isArray(c.hs_hot_notes.notes) ? c.hs_hot_notes : { scannedAt: 0, notes: [] };
  return { ok: true, notes: store.notes.slice(0, 60), scannedAt: store.scannedAt };
}

// NOTE_DETAIL / NOTE_COMMENTS — transient buffers the nethook relay fills while
// extractSourceNote holds a source note open (kind "noteDetail"/"noteComments"). Keyed by
// noteId (comments also under "__last" since exactly one note is open at a time). Cleared
// per-extract; never persisted.
const NOTE_DETAIL = new Map();
const NOTE_COMMENTS = new Map();

// extractSourceNote — open a hot note in a background window and FULLY decompose it for remix.
// Uses the note's captured xsec_token to build an openable explore/<id> URL (the same pathway
// runCommentSection uses for seeds — a token-authorized open is NOT sec-gated, unlike a cold
// deep-URL nav). nethook captures the signed /feed (full note_card: desc + every image + tags)
// and /comment/page (top comments); contentRPC extractNote + gatherComments supplement via DOM.
// Returns { ok, dossier } — the rich source material the deep remix reasons over. Read-only.
async function extractSourceNote(note) {
  if (SESSION.running) return { ok: false, error: "a 养号 session is running — remix after it finishes" };
  const noteId = note.noteId;
  if (!noteId) return { ok: false, error: "note has no id" };
  NOTE_DETAIL.delete(noteId);
  NOTE_COMMENTS.delete(noteId);
  NOTE_COMMENTS.delete("__last");
  let winId = null, tabId = null;
  try {
    const url =
      "https://www.xiaohongshu.com/explore/" + noteId +
      (note.xsecToken ? "?xsec_token=" + encodeURIComponent(note.xsecToken) + "&xsec_source=pc_feed" : "");
    const w = await chrome.windows.create({ url, type: "popup", width: 1100, height: 840, focused: false });
    winId = w && w.id;
    tabId = w && w.tabs && w.tabs[0] && w.tabs[0].id;
    if (!tabId) return { ok: false, error: "could not open note window" };
    await waitTabLoaded(tabId);
    await contentRPC(tabId, "sleep", { min: 1800, max: 2800 }); // /feed fires + is captured
    const risk = await checkRisk(tabId);
    if (risk) {
      await onRisk(risk, tabId);
      return { ok: false, error: "risk opening source note: " + risk };
    }
    // DOM supplement (fallback when /feed capture missed) + trigger /comment/page for nethook.
    const dom = (await contentRPC(tabId, "extractNote")) || {};
    await contentRPC(tabId, "loadComments", {});
    await contentRPC(tabId, "sleep", { min: 900, max: 1600 });
    const g = await contentRPC(tabId, "gatherComments");
    await contentRPC(tabId, "sleep", { min: 700, max: 1300 }); // let the last captures land
    await hotChain;

    const cap = NOTE_DETAIL.get(noteId) || {};
    const capComments = NOTE_COMMENTS.get(noteId) || NOTE_COMMENTS.get("__last") || null;
    const images = cap.images && cap.images.length ? cap.images : dom.images || [];
    const tags = cap.tags && cap.tags.length ? cap.tags : dom.tags || [];
    const num = (a, b) => (a != null ? parseCountBg(a) : b != null ? b : null);
    const topComments = (
      capComments && capComments.length
        ? capComments.map((c) => ({ content: c.content, likeCount: parseCountBg(c.likeCount), ipLocation: c.ipLocation }))
        : ((g && g.comments) || []).map((c) => ({ content: c.content, likeCount: c.likeCount, ipLocation: c.ipLocation }))
    )
      .filter((c) => c.content)
      .slice(0, 12);
    const dossier = {
      noteId,
      title: cap.title || dom.title || note.title || "",
      desc: cap.desc || dom.desc || "",
      type: cap.type || note.type || "normal",
      images: images.slice(0, 12),
      tags: tags.slice(0, 20),
      likes: num(cap.likes, note.likes),
      collects: num(cap.collects, note.collects),
      comments: num(cap.comments, note.comments),
      shares: num(cap.shares, note.shares),
      authorName: cap.authorName || note.authorName || "",
      uploadTime: cap.uploadTime || null,
      ipLocation: cap.ipLocation || "",
      topComments,
    };
    const depth = (dossier.desc ? 1 : 0) + (dossier.images.length ? 1 : 0) + (dossier.topComments.length ? 1 : 0);
    event("source decomposed · " + dossier.images.length + " imgs · " + dossier.topComments.length + " comments · desc " + (dossier.desc ? dossier.desc.length + "字" : "—"), depth >= 2 ? "muted" : "warn");
    return { ok: true, dossier };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    if (winId != null) {
      try {
        await chrome.windows.remove(winId);
      } catch {}
    }
  }
}

// activePlanSubject — the operator's niche, read from the active working plan (used as the
// remix's 账号定位 hint when the portal passes none). "" when unknown.
async function activePlanSubject() {
  try {
    const c = await chrome.storage.local.get("hs_plan");
    return (c.hs_plan && c.hs_plan.subject) || "";
  } catch {
    return "";
  }
}

// ---- drafts (remix outputs) -------------------------------------------
async function loadDrafts() {
  const c = await chrome.storage.local.get("hs_drafts");
  return Array.isArray(c.hs_drafts) ? c.hs_drafts : [];
}
async function saveDrafts(arr) {
  await chrome.storage.local.set({ hs_drafts: (Array.isArray(arr) ? arr : []).slice(-DRAFTS_CAP) });
}
// cpLen — Unicode code-point length (CJK-correct char count for the publish gate).
function cpLen(s) {
  return s ? [...String(s)].length : 0;
}
// computePublishGate — the xhs-skill hard 门禁 as a renderable checklist: title 8–20 chars,
// body ≥80, ≥3 topics, anti-AI = the body carries a concrete signal (a digit or a specific
// detail marker — the cheap proxy for "个人视角 + 具体事实"). Pure; the portal renders pass/detail.
function computePublishGate(draft) {
  const title = (draft.titles && draft.titles[0]) || "";
  const tlen = cpLen(title);
  const blen = cpLen(draft.body);
  const topics = (draft.topics || []).filter(Boolean);
  const body = String(draft.body || "");
  const concrete = /\d/.test(body) || /[年月日号点元块米斤个次第]/.test(body);
  const gate = {
    title: { pass: tlen >= 8 && tlen <= 20, detail: tlen + " 字 · 建议 8–20" },
    body: { pass: blen >= 80, detail: blen + " 字 · 建议 ≥80" },
    topics: { pass: topics.length >= 3, detail: topics.length + " 个 · 建议 ≥3" },
    antiAi: { pass: concrete, detail: concrete ? "含具体信号" : "缺少数字/具体细节" },
  };
  gate.ok = gate.title.pass && gate.body.pass && gate.topics.pass && gate.antiAi.pass;
  return gate;
}
// makeDraft — assemble a stored Draft from the source dossier + the LLM remix object (incl.
// its `decode` reverse-engineering) + the gate. The dossier is kept on the draft so the portal
// can show the operator exactly what was reverse-engineered (source images, 正文, top comments).
function makeDraft(dossier, remix) {
  const d = {
    id: "draft_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    sourceNoteId: dossier.noteId || null,
    sourceTitle: dossier.title || "",
    createdAt: Date.now(),
    decode: remix.decode || null,
    titles: Array.isArray(remix.titles) ? remix.titles.slice(0, 3) : [],
    body: remix.body || "",
    cover: {
      main: (remix.cover && remix.cover.main) || "",
      sub: (remix.cover && remix.cover.sub) || "",
      prompt: (remix.cover && remix.cover.prompt) || "",
    },
    images: Array.isArray(remix.images) ? remix.images.slice(0, 9) : [],
    topics: Array.isArray(remix.topics) ? remix.topics.filter(Boolean).slice(0, 8) : [],
    source: {
      noteId: dossier.noteId || null,
      title: dossier.title || "",
      desc: dossier.desc || "",
      type: dossier.type || "normal",
      images: (dossier.images || []).slice(0, 12),
      tags: (dossier.tags || []).slice(0, 20),
      likes: dossier.likes,
      collects: dossier.collects,
      comments: dossier.comments,
      shares: dossier.shares,
      authorName: dossier.authorName || "",
      topComments: (dossier.topComments || []).slice(0, 12),
    },
  };
  d.gate = computePublishGate(d);
  return d;
}
async function upsertDraft(draft) {
  const arr = await loadDrafts();
  const idx = arr.findIndex((x) => x.id === draft.id);
  if (idx === -1) arr.push(draft);
  else arr[idx] = draft;
  await saveDrafts(arr);
  return arr;
}

// =====================================================================
// PUBLISH (creator.xiaohongshu.com — manual-gated, never auto-clicks 发布)
// The red line (RISK-MODEL ❌急于发笔记; CLAUDE.md): publishing is deliberate, separate from
// 养号, and the EXTENSION never clicks 发布 — it drives the creator page to PREFILL (图文 mode →
// 文字配图 cover → title → body), stops, and the OPERATOR picks ≥3 real topics + clicks 发布.
// Frequency门禁 from ref/xhs-skill A1: ≤3 / 24h, ≥30 min apart. We log each PREPARE as a proxy
// for an intended publish (we can't observe the manual click), so the cap errs conservative.
//   hs_publish_log = number[]  (prepare timestamps, capped)
// publisher.js (creator content script) exposes the "hs:pub" ops driven below.
// =====================================================================
const PUBLISH_MAX_24H = 3;
const PUBLISH_MIN_GAP_MS = 30 * 60 * 1000;

async function loadPublishLog() {
  const c = await chrome.storage.local.get("hs_publish_log");
  return Array.isArray(c.hs_publish_log) ? c.hs_publish_log : [];
}
// publishFreq — the frequency-gate view: how many prepares in the last 24h, when the next is
// allowed (the later of: 24h after the 3rd-most-recent, OR 30 min after the most recent).
async function publishFreq() {
  const log = await loadPublishLog();
  const now = Date.now();
  const last24 = log.filter((t) => now - t < 86400000).sort((a, b) => a - b);
  const todayCount = last24.length;
  let nextAllowedAt = 0;
  if (todayCount >= PUBLISH_MAX_24H) nextAllowedAt = Math.max(nextAllowedAt, last24[last24.length - PUBLISH_MAX_24H] + 86400000);
  const lastPreparedAt = log.length ? Math.max(...log) : 0;
  if (lastPreparedAt) nextAllowedAt = Math.max(nextAllowedAt, lastPreparedAt + PUBLISH_MIN_GAP_MS);
  return { todayCount, max: PUBLISH_MAX_24H, nextAllowedAt: nextAllowedAt > now ? nextAllowedAt : 0, lastPreparedAt };
}
async function recordPublishPrepare() {
  const log = await loadPublishLog();
  log.push(Date.now());
  await chrome.storage.local.set({ hs_publish_log: log.slice(-50) });
}
// bestTitle — the publish headline: the first candidate within the 8–20 char gate, else the
// first title hard-trimmed to 20 (the creator page enforces ≤20 anyway).
function bestTitle(titles) {
  const list = (titles || []).map((t) => String(t || "").trim()).filter(Boolean);
  const inGate = list.find((t) => cpLen(t) >= 8 && cpLen(t) <= 20);
  if (inGate) return inGate;
  const first = list[0] || "";
  return cpLen(first) > 20 ? [...first].slice(0, 20).join("") : first;
}

// pubRPC — like contentRPC but addressed to publisher.js (message type "hs:pub"). publisher.js
// co-injects on creator.xiaohongshu.com alongside engine.js; engine.js ignores "hs:pub" and
// publisher ignores "hs:action" (which we still use for sleep pacing). Same retry/backoff shape.
async function pubRPC(tabId, action, args, retries = 3) {
  let lastErr = "unreachable";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: "hs:pub", action, args: args || {} });
    } catch (e) {
      lastErr = String((e && e.message) || e);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 600));
    }
  }
  return { ok: false, error: lastErr };
}

// publishPrepare — open the creator publish page and PREFILL a draft via publisher.js, then
// STOP at the 发布 button. Enforces the frequency门禁 first. Returns the readback + what the
// operator must still do by hand. The window is FOCUSED (deliberate, operator-facing) — unlike
// the background 养号/scan windows.
async function publishPrepare(draftId) {
  if (SESSION.running) return { ok: false, error: "a 养号 session is running — publish after it finishes" };
  const drafts = await loadDrafts();
  const draft = drafts.find((d) => d.id === draftId);
  if (!draft) return { ok: false, error: "draft not found" };

  const freq = await publishFreq();
  if (freq.nextAllowedAt) {
    return { ok: false, error: "发布门禁：" + freq.todayCount + "/" + freq.max + " in 24h. Next allowed " + new Date(freq.nextAllowedAt).toLocaleString(), freq };
  }

  let winId = null, tabId = null;
  try {
    const w = await chrome.windows.create({ url: "https://creator.xiaohongshu.com/publish/publish", type: "normal", width: 1180, height: 900, focused: true });
    winId = w && w.id;
    tabId = w && w.tabs && w.tabs[0] && w.tabs[0].id;
    if (!tabId) return { ok: false, error: "could not open creator publish window" };
    await waitTabLoaded(tabId);
    await contentRPC(tabId, "sleep", { min: 2500, max: 4000 }); // preheat (xhs-skill: 先浏览再发布)

    // If we got bounced off /publish/publish (the doc's /new/home trap), retry once.
    let probe = (await pubRPC(tabId, "pubProbe")) || {};
    if (!probe.probe || !probe.probe.onPublishPage) {
      await chrome.tabs.update(tabId, { url: "https://creator.xiaohongshu.com/publish/publish" });
      await waitTabLoaded(tabId);
      await contentRPC(tabId, "sleep", { min: 2000, max: 3200 });
      probe = (await pubRPC(tabId, "pubProbe")) || {};
    }
    if (!probe.probe || !probe.probe.onPublishPage) {
      return { ok: false, error: "could not reach the 创作中心 publish page (login first?) — " + ((probe && probe.error) || "no publish UI") };
    }

    await pubRPC(tabId, "pubEnsureImageText", {});
    await contentRPC(tabId, "sleep", { min: 800, max: 1500 });
    // 文字配图 cover from the draft's 大字报 文案 (zero external-image dependency).
    const cov = await pubRPC(tabId, "pubTextCover", { main: draft.cover.main, sub: draft.cover.sub });
    await contentRPC(tabId, "sleep", { min: 1000, max: 1800 });
    const title = bestTitle(draft.titles);
    await pubRPC(tabId, "pubFillTitle", { text: title });
    await contentRPC(tabId, "sleep", { min: 500, max: 1100 });
    await pubRPC(tabId, "pubFillBody", { text: draft.body });
    await contentRPC(tabId, "sleep", { min: 500, max: 1000 });
    const rb = (await pubRPC(tabId, "pubReadback")) || {};
    await pubRPC(tabId, "pubFocusPublish", {});

    await recordPublishPrepare();
    const freq2 = await publishFreq();
    event("publish prefilled draft " + draftId + " (title " + cpLen(title) + "字, body " + cpLen(draft.body) + "字) — stopped at 发布", "info");
    return {
      ok: true,
      readback: { title: rb.title || title, titleLen: rb.titleLen != null ? rb.titleLen : cpLen(title), body: rb.body, bodyLen: rb.bodyLen != null ? rb.bodyLen : cpLen(draft.body) },
      cover: cov && cov.ok ? "文字配图 generated" : "cover step incomplete — add a cover by hand",
      gate: draft.gate,
      topics: draft.topics,
      freq: freq2,
      instructions: "封面+标题+正文已自动填好。请在创作页：①核对封面/标题/正文；②人工选择 ≥3 个真实话题（标签从话题选择器选，不要写进正文）；③确认预览后自己点【发布】。本工具不会替你发布。",
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
  // NOTE: deliberately do NOT close the window — the operator finishes the publish there.
}

// runSession — dispatch to the mode loop, then always release the session
// state (in-memory + persisted) so the popup sees it end.
async function runSession(plan) {
  let tabId = null;
  try {
    // Open/reuse the dedicated automation window warmed on /explore, then drive THAT
    // window — exactly Redaily's openXHS → in-window-navigation model.
    tabId = await ensureWindow();
    event("XHS window ready — tab " + tabId, "muted", await tabUrl(tabId));
    await pill(tabId, "starting…", "info");
    await contentRPC(tabId, "sleep", { min: 1500, max: 3000 });
    const r0 = await checkRisk(tabId);
    if (r0) {
      await setStage(tabId, null, null, "risk");
      await onRisk(r0, tabId);
      return;
    }
    // Resolve the AI endpoint/key once for this session (only used when a comment action's
    // source === "ai"; harmless to resolve otherwise). Passed into the mode loops so
    // runtime AI-comment generation doesn't re-read storage per note.
    const cCfg = await chrome.storage.local.get("hs_config");
    const aiCfg = aiConfig((cCfg.hs_config || DEFAULT_CONFIG).ai);

    if (plan.mode === PLAN.MODES.COMMENT_SECTION) await runCommentSection(tabId, plan, aiCfg);
    else if (plan.mode === PLAN.MODES.PROFILE) await runProfile(tabId, plan, aiCfg);
    else await runDiscovery(tabId, plan, aiCfg);

    // Auto-capture account traction at the end of every run (reuses this window, so no
    // extra popup). The very first capture sets the baseline; later runs show the Δ growth.
    // Best-effort — never let a stat read fail the session.
    if (!SESSION.stop) {
      try {
        await pill(tabId, "reading account…", "info");
        await snapshotAccount({ tabId });
      } catch (e) {
        event("account snapshot failed: " + String((e && e.message) || e), "muted");
      }
    }
  } catch (e) {
    event("session error: " + String((e && e.message) || e), "err");
  } finally {
    SESSION.running = false;
    const s = await loadGov();
    s.session.running = false;
    s.session.currentAction = SESSION.stop ? "stopped" : "done";
    await saveGov(s);
    // Leave the final pill visible (do NOT hidePill) so the operator sees the outcome.
    if (tabId != null) {
      await pill(
        tabId,
        (SESSION.stop ? "stopped" : "done") + " · " + (s.session.actionsTaken || 0) + " actions",
        SESSION.stop ? "warn" : "ok"
      );
    }
    event(SESSION.stop ? "session stopped" : "session ended", "info");
    await exportLog(SESSION.stop ? "stopped" : "ended");
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case "hs:getConfig": {
          const c = await chrome.storage.local.get("hs_config");
          sendResponse({ ok: true, config: c.hs_config || DEFAULT_CONFIG });
          break;
        }
        case "hs:setConfig": {
          await chrome.storage.local.set({ hs_config: msg.config });
          sendResponse({ ok: true });
          break;
        }
        case "hs:getPlan": {
          const c = await chrome.storage.local.get("hs_plan");
          const plan = PLAN.normalizePlan(c.hs_plan);
          sendResponse({ ok: true, plan, summary: PLAN.describePlan(plan) });
          break;
        }
        case "hs:setPlan": {
          // Normalize whatever was handed in (manual edit OR future AI output) before storing.
          const plan = PLAN.normalizePlan(msg.plan);
          await chrome.storage.local.set({ hs_plan: plan });
          sendResponse({ ok: true, plan, summary: PLAN.describePlan(plan) });
          break;
        }
        // ---- plan library ------------------------------------------------
        case "hs:plans:list": {
          const { plans, activeId } = await loadPlans();
          sendResponse({ ok: true, plans: sortedPlans(plans), activeId });
          break;
        }
        case "hs:plans:save": {
          const { plans, entry } = await upsertPlan(msg.plan, msg.name, (msg.plan && msg.plan.source) || "manual");
          sendResponse({ ok: true, plan: entry, plans: sortedPlans(plans), activeId: entry.id, summary: PLAN.describePlan(entry) });
          break;
        }
        case "hs:plans:select": {
          const { plans } = await loadPlans();
          const entry = plans.find((p) => p.id === msg.id);
          if (!entry) {
            sendResponse({ ok: false, error: "plan not found" });
            break;
          }
          await chrome.storage.local.set({ hs_plan: entry, hs_active_plan_id: entry.id });
          sendResponse({ ok: true, plan: entry, summary: PLAN.describePlan(entry) });
          break;
        }
        case "hs:plans:delete": {
          let { plans, activeId } = await loadPlans();
          plans = plans.filter((p) => p.id !== msg.id);
          if (activeId === msg.id) activeId = plans.length ? sortedPlans(plans)[0].id : null;
          await savePlans(plans, activeId);
          if (activeId) {
            const a = plans.find((p) => p.id === activeId);
            if (a) await chrome.storage.local.set({ hs_plan: a });
          }
          sendResponse({ ok: true, plans: sortedPlans(plans), activeId });
          break;
        }

        // ---- auto-scheduler (错峰) ----------------------------------------
        case "hs:schedule:sync": {
          // The panel calls this after saving a plan so its schedule takes effect immediately.
          const armed = await syncSchedules();
          sendResponse({ ok: true, armed });
          break;
        }
        case "hs:schedule:list": {
          // Read-only view of what is scheduled + each plan's next run time. Prefer the
          // ACTUAL armed alarm (it carries the fire jitter); fall back to the computed one.
          const { plans } = await loadPlans();
          const now = Date.now();
          const scheduled = [];
          for (const p of plans) {
            if (!p.schedule || !p.schedule.enabled) continue;
            let nextRunAt = null;
            try {
              const a = chrome.alarms ? await chrome.alarms.get(PLAN_ALARM_PREFIX + p.id) : null;
              nextRunAt = (a && a.scheduledTime) || null;
            } catch {}
            if (nextRunAt == null) nextRunAt = nextOccurrence(p.schedule, now);
            scheduled.push({ id: p.id, name: p.name, mode: p.mode, schedule: p.schedule, nextRunAt });
          }
          scheduled.sort((a, b) => (a.nextRunAt || Infinity) - (b.nextRunAt || Infinity));
          sendResponse({ ok: true, scheduled });
          break;
        }
        case "hs:campaign:accept": {
          // ONE click arms a generated campaign: enable the schedule on each given plan id
          // (the AI already decided + we jittered the times), then re-derive the alarms.
          // The operator never edits times — accept is the whole interaction.
          const ids = Array.isArray(msg.ids) ? msg.ids : [];
          const { plans, activeId } = await loadPlans();
          const armedPlans = [];
          for (const p of plans) {
            if (!ids.includes(p.id)) continue;
            if (!p.schedule || !p.schedule.timeOfDay) continue; // nothing to arm
            p.schedule.enabled = true;
            armedPlans.push(p);
          }
          await savePlans(plans, activeId);
          await syncSchedules();
          const scheduled = [];
          for (const p of armedPlans) {
            let nextRunAt = null;
            try {
              const a = chrome.alarms ? await chrome.alarms.get(PLAN_ALARM_PREFIX + p.id) : null;
              nextRunAt = (a && a.scheduledTime) || null;
            } catch {}
            scheduled.push({ id: p.id, name: p.name, mode: p.mode, label: (p.schedule && p.schedule.label) || "", nextRunAt });
          }
          event("campaign accepted — " + scheduled.length + " plan(s) armed (错峰)", "info");
          sendResponse({ ok: true, scheduled, plans: sortedPlans(plans), activeId });
          break;
        }

        // ---- self-feeding pipeline status (the home "养号 pipeline" tile) -----
        case "hs:pipeline:status": {
          // The heartbeat the operator watches instead of clicking: how the lead pool is
          // filling (accumulated) and draining (visited), how many notes are queued for the
          // harvester, what runs next, and the active warming phase. All derived from stores.
          const targets = await loadTargets();
          const seenUsers = await loadSeen("hs_seen_users");
          let queued = 0,
            visited = 0;
          for (const t of targets) {
            const uid = realUserId(t);
            if (!uid) continue;
            if (Object.prototype.hasOwnProperty.call(seenUsers, uid)) visited++;
            else if (t.profileUrl) queued++; // un-visited & navigable → a profile plan will drain it
          }
          const hotNotes = await hotNotesCount();
          const { plans } = await loadPlans();
          const now = Date.now();
          const nextRuns = [];
          for (const p of plans) {
            if (!p.schedule || !p.schedule.enabled) continue;
            let nextRunAt = null;
            try {
              const a = chrome.alarms ? await chrome.alarms.get(PLAN_ALARM_PREFIX + p.id) : null;
              nextRunAt = (a && a.scheduledTime) || null;
            } catch {}
            if (nextRunAt == null) nextRunAt = nextOccurrence(p.schedule, now);
            nextRuns.push({ mode: p.mode, label: (p.schedule.label || ""), nextRunAt, seedSource: p.seedSource });
          }
          nextRuns.sort((a, b) => (a.nextRunAt || Infinity) - (b.nextRunAt || Infinity));
          sendResponse({
            ok: true,
            pool: { accumulated: targets.length, queued, visited },
            hotNotes,
            nextRuns,
            warming: warmingState(await loadAccount()),
          });
          break;
        }

        case "hs:ai:plan": {
          // The planner EMITS a COORDINATED SET of 3 single-mode plans (a 养号 campaign):
          // one discovery, one comment_section, one profile, sharing the niche, with staggered
          // suggested run-times (错峰). We do NOT auto-run, but DO persist ALL 3 to the library
          // so they are recallable; the discovery plan becomes active + loads in the editor.
          const c = await chrome.storage.local.get("hs_config");
          const cfg = c.hs_config || DEFAULT_CONFIG;
          try {
            const set = await PLANNER.generatePlanSet(msg.subject, aiConfig(cfg.ai));
            const raws = (set.plans || []).slice(0, 3);
            // Persist sequentially (each upsertPlan re-reads/writes the pool) so the pool ends
            // with all 3. upsertPlan normalizes, assigns id, sets savedAt, hs_plan + active.
            const entries = [];
            for (const raw of raws) {
              // The plan NAME is the niche only — mode and schedule live in their own
              // fields and surface as tags in the UI (never duplicated into the name).
              // The AI-proposed time gets a one-off ±18min jitter here; it stays DISARMED
              // (enabled:false) until the operator accepts the campaign (hs:campaign:accept).
              const sched = raw.schedule || {};
              // seedSource is set by ROLE, not by the LLM: discovery searches keywords; the
              // other two self-feed (comment_section harvests discovered notes, profile drains
              // the lead pool) — so they carry NO pasted URLs and resolve their work at run time.
              const seedSource = raw.mode === PLAN.MODES.DISCOVERY ? PLAN.SEED_SOURCE.KEYWORDS : PLAN.SEED_SOURCE.AUTO;
              // Enforce each plan's ROLE in the loop (architecture, not creative choice — counts,
              // keywords, comments, timing all stay the AI's). The harvester must NOT follow (so
              // its commenters stay unvisited and accumulate); the closer MUST follow (it's where
              // following happens, on the drained leads) + gathers to enrich. Guarantees the loop
              // works regardless of how exactly the LLM filled actionMix.
              const am = raw.actionMix || (raw.actionMix = {});
              const setEnabled = (key, on) => { am[key] = Object.assign({}, am[key]); am[key].enabled = on; };
              if (raw.mode === PLAN.MODES.COMMENT_SECTION) {
                setEnabled("gather", true);
                setEnabled("follow", false);
              } else if (raw.mode === PLAN.MODES.PROFILE) {
                setEnabled("follow", true);
                setEnabled("gather", true);
                if (!(+am.follow.count > 0)) am.follow.count = DEFAULT_CONFIG.autoSeed.profileVisitsPerRun; // ensure the closer actually follows
              }
              const merged = Object.assign({}, raw, {
                source: "ai",
                subject: msg.subject,
                seedSource,
                schedule: { label: sched.label || "", timeOfDay: jitterTimeOfDay(sched.timeOfDay), enabled: false },
              });
              const name = msg.subject ? msg.subject.slice(0, 20) : raw.mode;
              const { entry } = await upsertPlan(merged, name, "ai");
              entries.push(entry);
            }
            // The discovery plan becomes the active/working plan (loads in the editor).
            const active = entries.find((e) => e.mode === PLAN.MODES.DISCOVERY) || entries[0];
            await chrome.storage.local.set({ hs_plan: active, hs_active_plan_id: active.id });
            const { plans } = await loadPlans();
            sendResponse({
              ok: true,
              plan: active,
              plans: sortedPlans(plans),
              activeId: active.id,
              summary: PLAN.describePlan(active),
              generated: entries.map((e) => ({ id: e.id, mode: e.mode, name: e.name, schedule: e.schedule || null })),
            });
          } catch (e) {
            sendResponse({ ok: false, error: String((e && e.message) || e) });
          }
          break;
        }
        // ---- account stats (traction) ------------------------------------
        case "hs:account:observed": {
          // From nethook.js (via engine.js relay): a passively-sniffed page response.
          const p = (msg && msg.payload) || {};
          if (p.kind === "me" && p.userId) {
            const acc = await loadAccount();
            if (acc.selfId !== p.userId || (p.nickname && acc.nickname !== p.nickname)) {
              acc.selfId = p.userId;
              if (p.nickname) acc.nickname = p.nickname;
              await saveAccount(acc);
            }
          } else if (p.kind === "profile") {
            const acc = await loadAccount();
            // Only snapshot OUR account (the otherinfo target must match our resolved id).
            if (acc.selfId && p.targetUserId && String(p.targetUserId) === String(acc.selfId)) {
              const c = interactionsToCounts(p.interactions);
              await recordTotals({ selfId: acc.selfId, nickname: p.nickname, fans: c.followers, follows: c.following, interaction: c.likes });
            }
          } else if (p.kind === "received") {
            // From nethook on the notifications page: incoming likes/collects or new followers.
            await recordReceived(p.stream, p.items);
          } else if (p.kind === "feed") {
            // From nethook on a fed page (/homefeed or /search/notes): hot-note candidates for
            // the Content Studio trend radar. Recorded always — a normal discovery run fills it
            // for free, and an explicit scan (scanHotNotes) just generates more of this traffic.
            await recordHotNotes(p.source, p.notes);
          } else if (p.kind === "noteDetail" && p.detail && p.detail.noteId) {
            // Full source-note detail captured while extractSourceNote has the note open.
            NOTE_DETAIL.set(p.detail.noteId, p.detail);
          } else if (p.kind === "noteComments" && p.comments) {
            // Source-note comments (评论区 signals). Key by note_id when the URL carried one;
            // also stash as `last` since the extractor opens exactly one note at a time.
            if (p.noteId) NOTE_COMMENTS.set(p.noteId, p.comments);
            NOTE_COMMENTS.set("__last", p.comments);
          } else if (p.kind === "risk" && p.signal) {
            // Semantic block signal from the page's own traffic. Only act during a session
            // (idle false-positives shouldn't pause anything); otherwise just note it.
            if (SESSION.running) await onRisk("net: " + p.signal, SESSION.windowTabId);
            else event("net signal (idle): " + p.signal, "muted");
          }
          sendResponse({ ok: true });
          break;
        }
        case "hs:account:get": {
          const acc = await loadAccount();
          sendResponse({ ok: true, view: computeAccountView(acc) });
          break;
        }
        case "hs:account:refresh": {
          const r = await snapshotAccount({});
          if (r.ok) sendResponse({ ok: true, view: computeAccountView(r.account) });
          else sendResponse({ ok: false, error: r.error || "snapshot failed" });
          break;
        }

        // ---- targets (采集用户 — harvested leads) -------------------------
        case "hs:targets:list": {
          const arr = await loadTargets();
          const sorted = arr.slice().sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
          const groups = [...new Set(arr.map((t) => t.group).filter(Boolean))];
          sendResponse({ ok: true, targets: sorted, groups });
          break;
        }
        case "hs:targets:clear": {
          if (msg.group) {
            const arr = await loadTargets();
            await saveTargets(arr.filter((t) => t.group !== msg.group));
          } else {
            await saveTargets([]);
          }
          sendResponse({ ok: true });
          break;
        }
        case "hs:targets:export": {
          try {
            const count = await exportTargets();
            sendResponse({ ok: true, count });
          } catch (e) {
            sendResponse({ ok: false, error: String((e && e.message) || e) });
          }
          break;
        }

        // ---- seen memory (cross-session dedup) ---------------------------
        case "hs:seen:stats": {
          const notes = await loadSeen("hs_seen_notes");
          const users = await loadSeen("hs_seen_users");
          sendResponse({ ok: true, notes: Object.keys(notes).length, users: Object.keys(users).length });
          break;
        }
        case "hs:seen:clear": {
          // which: "notes" | "users" | undefined (both). Resets the dedup memory so a fresh
          // dry-run can re-browse the same feed during testing.
          const which = msg && msg.which;
          const keys = which === "notes" ? ["hs_seen_notes"] : which === "users" ? ["hs_seen_users"] : ["hs_seen_notes", "hs_seen_users"];
          await chrome.storage.local.remove(keys);
          sendResponse({ ok: true, cleared: keys });
          break;
        }

        // Open the Content Studio portal (separate full-page UI for content/publishing/stats).
        // Content scripts can't call chrome.tabs.create, so the panel routes through here.
        case "hs:portal:open": {
          try {
            await chrome.tabs.create({ url: chrome.runtime.getURL("portal/portal.html") });
            sendResponse({ ok: true });
          } catch (e) {
            sendResponse({ ok: false, error: String((e && e.message) || e) });
          }
          break;
        }

        // ---- content studio (trend radar + remix + drafts) ---------------
        case "hs:studio:hot": {
          // Read-only: return the stored scored hot notes (no scan).
          await hotChain;
          const c = await chrome.storage.local.get("hs_hot_notes");
          const store = c.hs_hot_notes && Array.isArray(c.hs_hot_notes.notes) ? c.hs_hot_notes : { scannedAt: 0, notes: [] };
          sendResponse({ ok: true, notes: store.notes.slice(0, 60), scannedAt: store.scannedAt });
          break;
        }
        case "hs:studio:scan": {
          // Open a background window, browse to generate feed traffic, return fresh top notes.
          sendResponse(await scanHotNotes({ keywords: msg.keywords || [] }));
          break;
        }
        case "hs:studio:remix": {
          // DEEP Viral-Copy: open + fully decompose the source note, reverse-engineer why it
          // worked (decode), then 结构级复刻 it into a publishable draft. The whole source
          // dossier is stored on the draft so the operator sees what was learned.
          const c = await chrome.storage.local.get(["hs_hot_notes", "hs_config"]);
          const store = c.hs_hot_notes && Array.isArray(c.hs_hot_notes.notes) ? c.hs_hot_notes : { notes: [] };
          const note = store.notes.find((n) => n.noteId === msg.noteId);
          if (!note) {
            sendResponse({ ok: false, error: "note not in the current scan — scan again" });
            break;
          }
          const cfg = c.hs_config || DEFAULT_CONFIG;
          try {
            const ai = aiConfig(cfg.ai);
            const niche = (msg.niche && String(msg.niche).trim()) || (await activePlanSubject());
            event("remix: decomposing source " + (note.title || note.noteId) + "…", "muted");
            const ex = await extractSourceNote(note);
            if (!ex.ok) {
              sendResponse({ ok: false, error: "could not read source note: " + ex.error });
              break;
            }
            // Best-effort vision reverse-engineering of the cover (degrades to "" if the model
            // isn't multimodal or the CDN blocks the fetch — the deep TEXT dossier still drives it).
            let coverAnalysis = "";
            try {
              coverAnalysis = await PLANNER.analyzeCover(ex.dossier.images, ai);
            } catch (e) {}
            const remix = await PLANNER.generateRemix(ex.dossier, { niche, coverAnalysis }, ai);
            const draft = makeDraft(ex.dossier, remix);
            await upsertDraft(draft);
            event("remix → draft for " + (note.title || note.noteId) + (coverAnalysis ? " (+vision)" : ""), "info");
            sendResponse({ ok: true, draft });
          } catch (e) {
            sendResponse({ ok: false, error: String((e && e.message) || e) });
          }
          break;
        }
        case "hs:studio:drafts": {
          const arr = await loadDrafts();
          sendResponse({ ok: true, drafts: arr.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) });
          break;
        }
        case "hs:studio:draft:save": {
          // The operator edited the draft in the portal — recompute the gate and persist.
          const d = msg.draft || {};
          if (!d.id) {
            sendResponse({ ok: false, error: "draft has no id" });
            break;
          }
          d.gate = computePublishGate(d);
          await upsertDraft(d);
          sendResponse({ ok: true, draft: d });
          break;
        }
        case "hs:studio:draft:delete": {
          const arr = (await loadDrafts()).filter((x) => x.id !== msg.id);
          await saveDrafts(arr);
          sendResponse({ ok: true });
          break;
        }

        // ---- publish (creator.xiaohongshu.com — manual-gated prefill) ----
        case "hs:studio:publish:prepare": {
          sendResponse(await publishPrepare(msg.draftId));
          break;
        }
        case "hs:studio:publish:status": {
          const freq = await publishFreq();
          sendResponse({ ok: true, ...freq });
          break;
        }

        case "hs:status":
          sendResponse(await runOnContent("status", {}));
          break;
        case "hs:run":
          sendResponse(await runOnContent(msg.action, msg.args || {}));
          break;

        // ---- session runner + governor ------------------------------------
        case "hs:session:start": {
          // No active XHS tab required — we open our own dedicated automation window
          // (Redaily's model). startSession guards against a double-start and (on success)
          // launches runSession DETACHED, so we respond immediately.
          const r = await startSession(msg.plan, "manual");
          sendResponse(r);
          break;
        }
        case "hs:session:stop": {
          SESSION.stop = true; // in-memory kill switch the loop checks each step
          const state = await loadGov();
          state.session.running = false;
          state.session.paused = false;
          await saveGov(state);
          sendResponse({ ok: true });
          break;
        }
        case "hs:session:ended": {
          const state = await loadGov();
          state.session.running = false;
          await saveGov(state);
          sendResponse({ ok: true });
          break;
        }
        case "hs:session:status": {
          // Read-only: do NOT persist here. The 1 s poll is the most frequent caller;
          // saving would race the runner's gov:acted writes and drop counter increments.
          const state = GOV.clearRiskIfElapsed(await loadGov(), Date.now());
          // Tell a content-script caller whether it lives in the spawned automation window
          // (panel.js uses this to suppress auto-show there). sender.tab is absent for the popup.
          const isAutomationWindow = !!(SESSION.windowTabId != null && sender && sender.tab && sender.tab.id === SESSION.windowTabId);
          const snap = GOV.snapshot(state, await getEffectiveCaps(), Date.now());
          snap.warming = warmingState(await loadAccount()); // surface the active warming phase
          sendResponse({ ok: true, isAutomationWindow, status: snap, events: RECENT.slice(-60) });
          break;
        }
        case "hs:gov:reset": {
          const state = await loadGov();
          state.counters = { like: [], collect: [], follow: [], comment: [] };
          state.risk = { paused: false, level: 0, until: 0, lastSignal: null };
          await saveGov(state);
          sendResponse({ ok: true });
          break;
        }
        case "hs:gov:can": {
          const state = GOV.clearRiskIfElapsed(await loadGov(), Date.now());
          sendResponse(GOV.canAct(state, msg.action, await getEffectiveCaps(), Date.now()));
          break;
        }
        case "hs:gov:acted": {
          const state = await loadGov();
          GOV.recordAction(state, msg.action, Date.now());
          await saveGov(state);
          sendResponse({ ok: true });
          break;
        }
        case "hs:risk:report": {
          const state = GOV.applyRisk(await loadGov(), msg.signal, Date.now());
          await saveGov(state);
          pushEvent({ t: Date.now(), level: "warn", line: "RISK: " + (msg.signal || "signal") + " → backoff " + Math.ceil((state.risk.until - Date.now()) / 1000) + "s" });
          await exportLog("risk");
          sendResponse({ ok: true, risk: state.risk });
          break;
        }
        case "hs:event": {
          pushEvent({ t: msg.t || Date.now(), level: msg.level || "info", line: msg.line || "", url: msg.url || undefined });
          sendResponse({ ok: true });
          break;
        }
        case "hs:log:export": {
          const okx = await exportLog("manual");
          sendResponse({ ok: okx !== false, count: SESSIONLOG.length });
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message type: " + (msg && msg.type) });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // async sendResponse
});
