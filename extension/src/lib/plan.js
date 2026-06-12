// plan.js — the Plan schema: the contract between the "brain" and the "spine".
//
// Reconstructed from Redaily's task/filter model (recovered from its bundle), with the
// cloud envelope dropped and our governance + AI-seed fields added. A human fills a Plan
// today; the AI planner fills the SAME shape later (PLAN §17). The runner consumes a Plan;
// the governor clamps it. Nothing else needs to change when AI arrives.
//
// Shared module: attaches to globalThis.__hs so both the background service worker
// (importScripts) and content scripts (content_scripts array) can use it.

(function () {
  const g = globalThis;
  const NS = (g.__hs = g.__hs || {});
  if (NS.plan) return;

  // ---- enums (faithful to Redaily's recovered values) ----------------------
  const MODES = {
    DISCOVERY: "discovery", // task:explore  — 发现页养号 (keyword broad-net on the feed)
    COMMENT_SECTION: "comment_section", // task:comments — 评论区养号 (target note → its commenters)
    PROFILE: "profile", // task:profile  — 主页养号 (a profile's followers/visitors)
  };
  const NUM_OP = { GTE: "gte", LTE: "lte", ANY: "any" }; // 大于等于 / 小于等于 / 不限
  const TEXT_OP = { CONTAINS: "contains", EQUALS: "equals", ANY: "any" }; // 包含 / 等于 / 不限
  const GENDER = { MALE: "male", FEMALE: "female", ANY: "unlimited" }; // 男 / 女 / 不限
  const COMMENT_SOURCE = { LIST: "list", AI: "ai" }; // fixed candidate list vs local LLM
  // SEED_SOURCE — where a plan's work-list comes from at run time. This is what lets the
  // campaign self-feed with no pasting: discovery harvests, profile drains the lead pool.
  //   keywords = discovery search terms (seeds ARE the keywords)
  //   manual   = operator-pasted note/profile URLs (seeds ARE the URLs)
  //   auto     = sourced at run time from accumulated state — profile pulls unvisited leads
  //              from the targets KB; comment_section pulls fresh notes discovery surfaced.
  const SEED_SOURCE = { KEYWORDS: "keywords", MANUAL: "manual", AUTO: "auto" };

  // ---- typedefs (JSDoc — "typed" without a build step) ---------------------
  /** @typedef {{ op: 'gte'|'lte'|'any', value: number }} NumericFilter */
  /** @typedef {{ op: 'contains'|'equals'|'any', values: string[] }} TextFilter */
  /**
   * A harvested commenter/user — the unit the filter is applied to.
   * @typedef {Object} Target
   * @property {string}  userId
   * @property {string} [noteId]
   * @property {string} [commentId]
   * @property {string} [content]     // the commenter's comment text
   * @property {('male'|'female'|'unknown')} [gender]
   * @property {number} [likeCount]   // likes on their comment
   * @property {string} [ipLocation]  // region label, e.g. "上海"
   * @property {number} [followers]
   * @property {number} [following]
   * @property {number} [likes]       // 获赞与收藏 (likes+collects total) on the user's profile
   */
  /**
   * @typedef {Object} TargetFilter
   * @property {('male'|'female'|'unlimited')} gender
   * @property {NumericFilter} followers
   * @property {NumericFilter} following
   * @property {NumericFilter} likes            // 获赞与收藏 (likes+collects total) on the profile
   * @property {NumericFilter} commentLikeCount
   * @property {NumericFilter} contentLength    // length of the commenter's comment
   * @property {string[]}      ipRegions        // allow-list of region labels; [] = any
   * @property {TextFilter}    keywordsInclude  // comment must match
   * @property {string[]}      keywordsExclude  // comment must NOT contain any of these
   */
  /**
   * Campaign schedule (错峰 staggered auto-run). FROZEN contract consumed by the
   * background scheduler (chrome.alarms) + the panel's schedule editor.
   * @typedef {Object} Schedule
   * @property {boolean}  enabled    // off by default; the scheduler only arms enabled plans
   * @property {string}   timeOfDay  // "HH:MM" 24h local; "" = unset (not scheduled)
   * @property {number[]} weekdays   // 0=Sun..6=Sat; [] = every day
   * @property {string}   label      // free-text campaign hint
   */
  /**
   * @typedef {Object} ActionMix
   * @property {{enabled:boolean,count:number}} like
   * @property {{enabled:boolean,count:number}} collect
   * @property {{enabled:boolean,count:number}} follow
   * @property {{enabled:boolean,count:number,source:'list'|'ai',comments:string[],emoji:boolean}} comment
   * @property {{enabled:boolean,group?:string}} gather
   */
  /**
   * @typedef {Object} Pacing
   * @property {[number,number]} betweenActionsMs  // jittered gap between actions
   * @property {[number,number]} dwellMs           // reading pause on each note
   * @property {number} notesPerSession            // soft target; governor still clamps
   */
  /**
   * @typedef {Object} Plan
   * @property {string}  id
   * @property {string}  name
   * @property {'manual'|'ai'} source            // who authored it (AI fills the same shape)
   * @property {string} [subject]                // natural-language seed (AI planner input)
   * @property {('discovery'|'comment_section'|'profile')} mode
   * @property {('keywords'|'manual'|'auto')} seedSource  // where the work-list comes from
   * @property {string[]} seeds                  // discovery: keywords; else: note/profile URLs (manual)
   * @property {TargetFilter} targetFilter
   * @property {ActionMix} actionMix
   * @property {Pacing} pacing
   * @property {Schedule} schedule               // 错峰 auto-run hint (scheduler reads this)
   * @property {('warming_early'|'warming'|'active')} warmingState
   * @property {boolean} dryRun                  // log intended actions, dispatch nothing
   */

  const anyNum = () => ({ op: NUM_OP.ANY, value: 0 });

  /** @returns {TargetFilter} */
  function defaultFilter() {
    return {
      gender: GENDER.ANY,
      followers: anyNum(),
      following: anyNum(),
      likes: anyNum(), // 获赞与收藏 (likes+collects total)
      commentLikeCount: anyNum(),
      contentLength: anyNum(),
      ipRegions: [],
      keywordsInclude: { op: TEXT_OP.ANY, values: [] },
      keywordsExclude: [],
    };
  }

  /** @returns {Schedule} — off by default; the scheduler ignores disabled plans. */
  function defaultSchedule() {
    return { enabled: false, timeOfDay: "", weekdays: [], label: "" };
  }

  /**
   * createDefaultPlan(mode) — a safe, conservative starting Plan. Counts are intended
   * volume only; the governor clamps them to RISK-MODEL caps at run time.
   * @param {string} mode
   * @returns {Plan}
   */
  function createDefaultPlan(mode = MODES.DISCOVERY) {
    return {
      id: "plan_" + mode,
      name: "Default " + mode + " plan",
      source: "manual",
      subject: "",
      mode,
      // discovery's seeds are keywords; the other two self-source from accumulated state
      // until the operator pastes explicit URLs (which flips them to "manual").
      seedSource: mode === MODES.DISCOVERY ? SEED_SOURCE.KEYWORDS : SEED_SOURCE.AUTO,
      seeds: [],
      targetFilter: defaultFilter(),
      actionMix: {
        like: { enabled: true, count: 10 },
        collect: { enabled: true, count: 3 },
        follow: { enabled: false, count: 5 },
        comment: { enabled: false, count: 2, source: COMMENT_SOURCE.LIST, comments: [], emoji: true },
        gather: { enabled: mode !== MODES.DISCOVERY, group: "" },
      },
      // Jittered pacing — the deliberate fix for Redaily's fixed sleep(2000).
      pacing: { betweenActionsMs: [3000, 9000], dwellMs: [8000, 20000], notesPerSession: 20 },
      // 错峰 auto-run schedule (off by default; armed by the background chrome.alarms scheduler).
      schedule: defaultSchedule(),
      warmingState: "warming_early",
      dryRun: true, // default to safe; runner flips this only on explicit operator action
    };
  }

  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  const clampPair = (p, d) => (Array.isArray(p) && p.length === 2 ? [num(p[0], d[0]), num(p[1], d[1])] : d);

  // deriveSeedSource — keep an explicit valid value; otherwise infer from mode + whether
  // URLs were pasted. discovery is always keywords; a URL-mode with pasted seeds is manual,
  // an empty one is auto (self-feeding). Editing the seeds field re-derives this downstream.
  function deriveSeedSource(input, mode) {
    if (Object.values(SEED_SOURCE).includes(input.seedSource)) return input.seedSource;
    if (mode === MODES.DISCOVERY) return SEED_SOURCE.KEYWORDS;
    return Array.isArray(input.seeds) && input.seeds.filter(Boolean).length ? SEED_SOURCE.MANUAL : SEED_SOURCE.AUTO;
  }

  // coerce an arbitrary weekdays value to a sorted, deduped int array in 0..6 (0=Sun..6=Sat).
  function coerceWeekdays(w) {
    if (!Array.isArray(w)) return [];
    const out = new Set();
    for (const d of w) {
      const n = Math.trunc(+d);
      if (Number.isFinite(n) && n >= 0 && n <= 6) out.add(n);
    }
    return [...out].sort((a, b) => a - b);
  }

  // normalizeSchedule — coerce an arbitrary (possibly AI-authored) schedule onto the frozen
  // shape. timeOfDay is validated loosely (kept as a string). weekdays → int array 0..6.
  function normalizeSchedule(s) {
    const d = defaultSchedule();
    if (!s || typeof s !== "object") return d;
    return {
      enabled: s.enabled === true,
      timeOfDay: typeof s.timeOfDay === "string" ? s.timeOfDay : "",
      weekdays: coerceWeekdays(s.weekdays),
      label: typeof s.label === "string" ? s.label : "",
    };
  }

  /**
   * normalizePlan(input) — deep-merge an arbitrary (possibly AI-authored) object onto the
   * defaults so the runner always receives a complete, type-coerced Plan.
   * @param {Partial<Plan>} input
   * @returns {Plan}
   */
  function normalizePlan(input) {
    const i = input || {};
    const base = createDefaultPlan(Object.values(MODES).includes(i.mode) ? i.mode : MODES.DISCOVERY);
    const f = i.targetFilter || {};
    const a = i.actionMix || {};
    const p = i.pacing || {};
    const mergeNum = (x) => (x && x.op ? { op: x.op, value: num(x.value, 0) } : undefined);
    const act = (name, d) => ({ ...d, ...(a[name] || {}) });
    return {
      ...base,
      id: i.id || base.id,
      name: i.name || base.name,
      source: i.source === "ai" ? "ai" : "manual",
      subject: typeof i.subject === "string" ? i.subject : "",
      mode: base.mode,
      seedSource: deriveSeedSource(i, base.mode),
      seeds: Array.isArray(i.seeds) ? i.seeds.filter(Boolean) : [],
      targetFilter: {
        ...base.targetFilter,
        ...f,
        followers: mergeNum(f.followers) || base.targetFilter.followers,
        following: mergeNum(f.following) || base.targetFilter.following,
        likes: mergeNum(f.likes) || base.targetFilter.likes,
        commentLikeCount: mergeNum(f.commentLikeCount) || base.targetFilter.commentLikeCount,
        contentLength: mergeNum(f.contentLength) || base.targetFilter.contentLength,
        ipRegions: Array.isArray(f.ipRegions) ? f.ipRegions : [],
        keywordsInclude: f.keywordsInclude && f.keywordsInclude.op ? f.keywordsInclude : base.targetFilter.keywordsInclude,
        keywordsExclude: Array.isArray(f.keywordsExclude) ? f.keywordsExclude : [],
      },
      actionMix: {
        like: act("like", base.actionMix.like),
        collect: act("collect", base.actionMix.collect),
        follow: act("follow", base.actionMix.follow),
        comment: act("comment", base.actionMix.comment),
        gather: act("gather", base.actionMix.gather),
      },
      pacing: {
        betweenActionsMs: clampPair(p.betweenActionsMs, base.pacing.betweenActionsMs),
        dwellMs: clampPair(p.dwellMs, base.pacing.dwellMs),
        notesPerSession: num(p.notesPerSession, base.pacing.notesPerSession),
      },
      // Campaign schedule (错峰 staggered auto-run). FROZEN shape, always present (default off);
      // the background chrome.alarms scheduler arms only plans with schedule.enabled === true.
      schedule: normalizeSchedule(i.schedule),
      warmingState: ["warming_early", "warming", "active"].includes(i.warmingState) ? i.warmingState : base.warmingState,
      dryRun: i.dryRun !== false, // default true unless explicitly false
      // Plan-library passthrough fields (preserved if present; not part of the runner contract).
      ...(Number.isFinite(+i.savedAt) ? { savedAt: +i.savedAt } : {}),
      ...(Number.isFinite(+i.lastRunAt) ? { lastRunAt: +i.lastRunAt } : {}),
    };
  }

  // newPlanId(mode) — a fresh library id for a plan. Date/Math.random are fine in the
  // extension runtime; collision-resistant enough for a 30-entry local library.
  function newPlanId(mode) {
    return "plan_" + (mode || "x") + "_" + Date.now() + "_" + Math.floor(Math.random() * 1e4);
  }

  function cmp(op, lhs, rhs) {
    if (op === NUM_OP.ANY) return true;
    if (op === NUM_OP.GTE) return lhs >= rhs;
    if (op === NUM_OP.LTE) return lhs <= rhs;
    return true;
  }

  /**
   * matchTarget(target, filter) — does a harvested commenter pass the Plan's filter?
   * Unknown/missing target fields are treated permissively (don't drop on missing data).
   * @param {Target} t
   * @param {TargetFilter} filter
   * @returns {boolean}
   */
  function matchTarget(t, filter) {
    if (!t || !filter) return true;
    if (filter.gender !== GENDER.ANY && t.gender && t.gender !== "unknown" && t.gender !== filter.gender) return false;
    if (t.followers != null && !cmp(filter.followers.op, t.followers, filter.followers.value)) return false;
    if (t.following != null && !cmp(filter.following.op, t.following, filter.following.value)) return false;
    if (t.likes != null && !cmp(filter.likes.op, t.likes, filter.likes.value)) return false;
    if (t.likeCount != null && !cmp(filter.commentLikeCount.op, t.likeCount, filter.commentLikeCount.value)) return false;
    const content = t.content || "";
    if (t.content != null && !cmp(filter.contentLength.op, content.length, filter.contentLength.value)) return false;
    if (filter.ipRegions.length && t.ipLocation && !filter.ipRegions.includes(t.ipLocation)) return false;
    const inc = filter.keywordsInclude;
    if (inc.op !== TEXT_OP.ANY && inc.values.length) {
      const hit = inc.op === TEXT_OP.EQUALS ? inc.values.includes(content) : inc.values.some((k) => content.includes(k));
      if (!hit) return false;
    }
    if (filter.keywordsExclude.length && filter.keywordsExclude.some((k) => content.includes(k))) return false;
    return true;
  }

  /** describePlan(plan) — one-line human summary for dry-run logs / the GUI. */
  function describePlan(plan) {
    const on = Object.entries(plan.actionMix)
      .filter(([, v]) => v.enabled)
      .map(([k, v]) => (v.count != null ? `${k}×${v.count}` : k))
      .join(", ");
    return `[${plan.mode}] seeds:${plan.seeds.length} · actions: ${on || "none"} · ${plan.dryRun ? "DRY-RUN" : "LIVE"}`;
  }

  NS.plan = {
    MODES,
    NUM_OP,
    TEXT_OP,
    GENDER,
    COMMENT_SOURCE,
    SEED_SOURCE,
    createDefaultPlan,
    normalizePlan,
    newPlanId,
    matchTarget,
    describePlan,
  };
})();
