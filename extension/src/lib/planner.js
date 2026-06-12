// planner.js — the AI "brain" that EMITS a Plan (never runs anything).
//
// An operator types a natural-language subject (e.g. "我做手工皮具，养一个种草号") and an
// OpenAI-compatible LLM returns a raw Plan object in the SAME shape as lib/plan.js. The
// background normalizes + clamps it, then the popup populates the plan editor so the
// operator reviews/edits before saving/running. This module only builds the request,
// calls the LLM, and returns the parsed JSON — no normalization, no side effects.
//
// Shared module: attaches to globalThis.__hs so the background service worker
// (importScripts) can use it. MV3 SW global `fetch` only — no SDK, no imports.

(function () {
  const g = globalThis;
  const NS = (g.__hs = g.__hs || {});
  if (NS.planner) return;

  // The system prompt: documents the Plan shape + enums (kept faithful to lib/plan.js)
  // and the conservative account-warming rules. The model must return JSON ONLY.
  const SYS = [
    "You design a Xiaohongshu (小红书) 养号 (account-warming) engagement Plan.",
    "Return a SINGLE JSON object ONLY — no prose, no markdown, no code fences.",
    "",
    "The operator gives a short natural-language subject describing their account/niche.",
    "Emit a Plan tuned for SAFE, gradual account warming. You only PROPOSE the plan; a",
    "human reviews and edits it before anything runs. Be conservative.",
    "",
    "FIELDS (use these exact keys and enum values):",
    "",
    "mode — one of: discovery | comment_section | profile",
    "  discovery       = keyword feed browsing (发现页养号). Default. Pick this unless the",
    "                    subject clearly calls for engaging a specific note or specific profiles.",
    "  comment_section = engage the commenters of a target note (评论区养号).",
    "  profile         = engage specific target profiles (主页养号).",
    "",
    "seeds — array of strings:",
    "  discovery                  -> 1 to 3 search keywords (Chinese), e.g. [\"手工皮具\",\"皮具教程\"].",
    "  comment_section | profile  -> [] (empty). The operator pastes the target URLs themselves.",
    "",
    "targetFilter — object:",
    "  gender           -> one of: unlimited | male | female",
    "  followers        -> { op: any|gte|lte, value: number }",
    "  commentLikeCount -> { op: any|gte|lte, value: number }",
    "  keywordsInclude  -> { op: any|contains|equals, values: string[] }",
    "  keywordsExclude  -> string[]",
    "  Use op:\"any\" (value 0, values []) when you have no strong filtering reason.",
    "",
    "actionMix — object:",
    "  like    -> { enabled: boolean, count: number }",
    "  collect -> { enabled: boolean, count: number }",
    "  follow  -> { enabled: boolean, count: number }",
    "  comment -> { enabled: boolean, count: number, source: \"list\", comments: string[], emoji: true }",
    "  gather  -> { enabled: boolean }",
    "",
    "pacing — object:",
    "  notesPerSession  -> number",
    "  betweenActionsMs -> [min, max]  (milliseconds)",
    "  dwellMs          -> [min, max]  (milliseconds)",
    "",
    "RULES (must follow):",
    "- Counts must be CONSERVATIVE for warming: like.count <= 15, collect.count <= 5,",
    "  follow.count <= 8, comment.count <= 3.",
    "- Do NOT include any \"submit\" field for comment (or set it to false). Never set submit true.",
    "- Pick the single best mode for the subject; default to discovery.",
    "- If comments make sense, set comment.enabled true and write 3 to 6 short, natural,",
    "  varied Chinese comment strings into comment.comments. Otherwise comment.enabled false.",
    "- Keep pacing humanized: betweenActionsMs around [3000, 9000], dwellMs around",
    "  [8000, 20000], notesPerSession <= 20.",
    "",
    "Output the JSON object only.",
  ].join("\n");

  // Campaign system prompt: reuses the FIELDS/RULES doc from SYS, but asks for a
  // COORDINATED 3-plan warming campaign (错峰 staggered run-times) instead of one plan.
  const SYS_CAMPAIGN = [
    SYS,
    "",
    "=== CAMPAIGN MODE (override the single-object instruction above) ===",
    "Instead of one plan, emit a COORDINATED warming campaign as a JSON object",
    "`{plans:[…]}` containing EXACTLY 3 plans, in this order:",
    "  (1) mode `discovery` with 1-3 Chinese keyword seeds;",
    "  (2) mode `comment_section` with seeds:[];",
    "  (3) mode `profile` with seeds:[].",
    "All 3 share the same niche/persona. Keep each conservative (same count caps:",
    "like<=15, collect<=5, follow<=8, comment<=3; never set submit).",
    "",
    "THE 3 PLANS FORM A SELF-FEEDING LOOP — the empty seeds:[] are INTENTIONAL, not a gap.",
    "The system auto-sources work at run time: discovery surfaces fresh niche notes;",
    "comment_section harvests the commenters of those notes into a lead pool; profile then",
    "gradually visits those accumulated leads. Configure each plan for its ROLE in the loop:",
    "- discovery (scout): like a little, collect the best, follow:false, gather:false.",
    "- comment_section (harvester): gather:true, follow:false — it only HARVESTS commenters",
    "  cheaply (do NOT follow here). like a few comments; comment optional. Keep targetFilter",
    "  PERMISSIVE (every op:\"any\") so harvesting stays wide and light.",
    "- profile (closer): follow:true — THIS is where following happens, on the accumulated",
    "  leads — plus like/collect a couple of their notes; gather:true to enrich. This mode",
    "  DRAINS the pool the harvester filled.",
    "",
    "SCHEDULING — YOU decide the run times; the operator never sets or sees raw times.",
    "Give each plan a `schedule` object `{label, timeOfDay}`:",
    "- timeOfDay: \"HH:MM\" 24h. Reason from the niche's audience rhythm (when are THEY",
    "  scrolling? commuting, lunch break, after dinner…) — pick the window where each mode",
    "  pays off most. Stay within 07:30-23:00.",
    "- ORDER FOR THE LOOP: discovery earliest, comment_section (harvest) next, profile LAST",
    "  (it drains what was just harvested). The 3 times MUST be staggered ≥3 hours apart.",
    "- Use organic-looking minutes (NOT :00/:15/:30/:45 — e.g. 08:47, 13:23, 21:08).",
    "  Do NOT reuse times from these instructions; derive your own from the niche.",
    "- label: a SHORT meaningful Chinese tag (2-6 chars) naming the slot's intent, e.g.",
    "  \"早间种草\" / \"午休截流\" / \"晚间深耕\". The UI shows ONLY this label, never the time.",
    "Return the JSON object only.",
  ].join("\n");

  // ---- structured-output schema ------------------------------------------
  // The exact shape we ask the model to emit. Only the five fields the model
  // authors are listed; id/name/source/subject/warmingState/dryRun are added by
  // the background + filled by normalizePlan (lib/plan.js). strict mode requires
  // every object to set additionalProperties:false and list all keys in required.
  const NUMF = {
    type: "object",
    additionalProperties: false,
    required: ["op", "value"],
    properties: { op: { type: "string", enum: ["any", "gte", "lte"] }, value: { type: "number" } },
  };
  const ACT_COUNT = {
    type: "object",
    additionalProperties: false,
    required: ["enabled", "count"],
    properties: { enabled: { type: "boolean" }, count: { type: "integer" } },
  };
  const PLAN_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["mode", "seeds", "targetFilter", "actionMix", "pacing"],
    properties: {
      mode: { type: "string", enum: ["discovery", "comment_section", "profile"] },
      seeds: { type: "array", items: { type: "string" } },
      targetFilter: {
        type: "object",
        additionalProperties: false,
        required: ["gender", "followers", "commentLikeCount", "keywordsInclude", "keywordsExclude"],
        properties: {
          gender: { type: "string", enum: ["unlimited", "male", "female"] },
          followers: NUMF,
          commentLikeCount: NUMF,
          keywordsInclude: {
            type: "object",
            additionalProperties: false,
            required: ["op", "values"],
            properties: {
              op: { type: "string", enum: ["any", "contains", "equals"] },
              values: { type: "array", items: { type: "string" } },
            },
          },
          keywordsExclude: { type: "array", items: { type: "string" } },
        },
      },
      actionMix: {
        type: "object",
        additionalProperties: false,
        required: ["like", "collect", "follow", "comment", "gather"],
        properties: {
          like: ACT_COUNT,
          collect: ACT_COUNT,
          follow: ACT_COUNT,
          comment: {
            type: "object",
            additionalProperties: false,
            required: ["enabled", "count", "source", "comments", "emoji"],
            properties: {
              enabled: { type: "boolean" },
              count: { type: "integer" },
              source: { type: "string", enum: ["list", "ai"] },
              comments: { type: "array", items: { type: "string" } },
              emoji: { type: "boolean" },
            },
          },
          gather: {
            type: "object",
            additionalProperties: false,
            required: ["enabled"],
            properties: { enabled: { type: "boolean" } },
          },
        },
      },
      pacing: {
        type: "object",
        additionalProperties: false,
        required: ["notesPerSession", "betweenActionsMs", "dwellMs"],
        properties: {
          notesPerSession: { type: "integer" },
          betweenActionsMs: { type: "array", items: { type: "integer" } },
          dwellMs: { type: "array", items: { type: "integer" } },
        },
      },
    },
  };

  // CAMPAIGN_SCHEMA — the COORDINATED set: exactly 3 plans, each a PLAN_SCHEMA item
  // PLUS a required `schedule` {label,timeOfDay}. Built by spreading PLAN_SCHEMA's
  // properties/required (no duplication) and adding schedule. strict mode requires
  // additionalProperties:false + every key in required on every object.
  const SCHEDULE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["label", "timeOfDay"],
    properties: { label: { type: "string" }, timeOfDay: { type: "string" } },
  };
  const PLAN_ITEM_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: [...PLAN_SCHEMA.required, "schedule"],
    properties: { ...PLAN_SCHEMA.properties, schedule: SCHEDULE_SCHEMA },
  };
  const CAMPAIGN_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["plans"],
    properties: {
      plans: { type: "array", minItems: 3, maxItems: 3, items: PLAN_ITEM_SCHEMA },
    },
  };

  // COMMENT_STYLES — optional per-note voicing hints a caller may pass via ctx.style
  // (from the 智能评论 research). Generation works fine with style omitted; this is
  // just a menu of natural human registers so a session's comments don't all read alike.
  const COMMENT_STYLES = [
    "真诚赞美",       // sincere, specific praise
    "互动提问",       // ask a genuine follow-up question
    "幽默",           // light humor / playful
    "情感共鸣",       // emotional resonance, relate to the feeling
    "实用信息分享",   // share a small useful tip
    "经验共鸣",       // "me too" / shared experience
    "好奇求教",       // curious, asking to learn
    "鼓励支持",       // encouraging / supportive
  ];

  // System prompt for per-note comment generation: ONE short,走心、具体 Chinese comment,
  // on-topic, banned generic filler, reply-aware when a commenter's text is supplied.
  const COMMENT_SYS = [
    "You write ONE short, natural, human-sounding Xiaohongshu (小红书) comment in Chinese.",
    "走心、具体、像真人. Forbidden: generic filler like '好美' '666' '不错' '学到了'.",
    "1 short sentence, at most one emoji. Stay on the note's topic.",
    "If a commenter's text is provided, you are REPLYING to that person — respond to what they said.",
    "Return ONLY the comment text — no quotes, no markdown, no explanation.",
  ].join("\n");

  // callLLM(ai, body) — one POST to the OpenAI-compatible endpoint. Returns the
  // assistant message content string; throws an Error (with .status/.body) on non-2xx.
  async function callLLM(ai, body) {
    const res = await fetch(ai.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + ai.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      const err = new Error("LLM HTTP " + res.status + ": " + text);
      err.status = res.status;
      err.body = text;
      throw err;
    }
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error("LLM returned empty response");
    return content;
  }

  /**
   * generatePlan(subject, ai) — call an OpenAI-compatible chat completions endpoint and
   * return the raw parsed Plan object (the background normalizes it). Prefers strict
   * structured output (response_format json_schema); falls back to json_object for
   * endpoints that don't support json_schema.
   * @param {string} subject  natural-language account description
   * @param {{endpoint:string,model:string,apiKey:string}} ai
   * @returns {Promise<object>} raw (un-normalized) Plan-shaped object
   */
  async function generatePlan(subject, ai) {
    if (!subject) throw new Error("no subject");
    if (!ai || !ai.apiKey) throw new Error("No API key configured — run the key-install command, then reload the extension");

    const base = {
      model: ai.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: subject },
      ],
    };

    let content;
    try {
      // Preferred: schema-enforced structured output.
      content = await callLLM(ai, {
        ...base,
        response_format: { type: "json_schema", json_schema: { name: "xhs_plan", strict: true, schema: PLAN_SCHEMA } },
      });
    } catch (e) {
      // The endpoint may not support json_schema (or rejected the schema). Retry once
      // with json_object — the widely-supported mode. If THAT fails, surface its error.
      content = await callLLM(ai, { ...base, response_format: { type: "json_object" } });
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new Error("LLM returned non-JSON");
    }
  }

  /**
   * generatePlanSet(subject, ai) — mirror generatePlan's call pattern (same callLLM, same
   * strict json_schema → json_object fallback) but with the campaign prompt + CAMPAIGN_SCHEMA.
   * Returns a `{plans:[…]}` object. Tolerates a bare-array response by wrapping it.
   * @param {string} subject  natural-language account description
   * @param {{endpoint:string,model:string,apiKey:string}} ai
   * @returns {Promise<{plans:object[]}>} raw (un-normalized) coordinated plan set
   */
  async function generatePlanSet(subject, ai) {
    if (!subject) throw new Error("no subject");
    if (!ai || !ai.apiKey) throw new Error("No API key configured — run the key-install command, then reload the extension");

    const base = {
      model: ai.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYS_CAMPAIGN },
        { role: "user", content: subject },
      ],
    };

    let content;
    try {
      // Preferred: schema-enforced structured output.
      content = await callLLM(ai, {
        ...base,
        response_format: { type: "json_schema", json_schema: { name: "xhs_plan_set", strict: true, schema: CAMPAIGN_SCHEMA } },
      });
    } catch (e) {
      // The endpoint may not support json_schema (or rejected the schema). Retry once
      // with json_object — the widely-supported mode. If THAT fails, surface its error.
      content = await callLLM(ai, { ...base, response_format: { type: "json_object" } });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("LLM returned non-JSON");
    }
    // Accept {plans:[…]} or a bare array; wrap the latter.
    if (parsed && Array.isArray(parsed.plans) && parsed.plans.length) return { plans: parsed.plans };
    if (Array.isArray(parsed) && parsed.length) return { plans: parsed };
    throw new Error("LLM returned no plans");
  }

  /**
   * generateComment(ctx, ai) — generate ONE short, content-aware, natural Chinese comment
   * for a single note (the 智能评论 feature). Plain-text completion (no response_format).
   * Best-effort + defensive: returns "" (never throws) when no key is set or on any error,
   * so the runner can fall back to its canned list or skip. Reuses callLLM.
   * @param {{subject?:string,noteTitle?:string,noteDesc?:string,commentText?:string,style?:string}} ctx
   *   subject     = the account's niche/persona; noteTitle/noteDesc = the note we're on;
   *   commentText = a commenter's comment we're REPLYING to (comment_section mode);
   *   style       = optional register hint (see COMMENT_STYLES).
   * @param {{endpoint:string,model:string,apiKey:string}} ai
   * @returns {Promise<string>} the comment text, or "" if unavailable
   */
  async function generateComment(ctx, ai) {
    if (!ai || !ai.apiKey) return ""; // caller falls back to canned/skip
    const c = ctx || {};

    // Assemble only the context that's actually present, in a stable order.
    const parts = [];
    if (c.subject) parts.push("账号定位/赛道：" + c.subject);
    if (c.noteTitle) parts.push("笔记标题：" + c.noteTitle);
    if (c.noteDesc) parts.push("笔记正文：" + c.noteDesc);
    if (c.commentText) parts.push("你要回复的评论（针对这条话回复，不要答非所问）：" + c.commentText);
    if (c.style) parts.push("风格倾向：" + c.style);
    parts.push("请写出这一条评论。");

    const body = {
      model: ai.model,
      temperature: 0.8, // higher for natural variety across a session
      messages: [
        { role: "system", content: COMMENT_SYS },
        { role: "user", content: parts.join("\n") },
      ],
    };

    try {
      const raw = await callLLM(ai, body); // plain text — no response_format
      // Normalize: single line, strip code fences + surrounding quotes, cap length.
      let out = String(raw || "").trim();
      out = out.replace(/^```[\w]*\s*/i, "").replace(/\s*```$/i, "").trim();
      out = out.replace(/\s+/g, " ").trim();
      out = out.replace(/^["'“”‘’「」『』]+/, "").replace(/["'“”‘’「」『』]+$/, "").trim();
      if (out.length > 60) out = out.slice(0, 60).trim();
      return out;
    } catch {
      return ""; // never throw — caller falls back to canned/skip
    }
  }

  // ---- Content Studio: Viral Copy remix (deep) ----------------------------
  // REMIX_SYS — the ops-skill's xhs-viral-copy-flow, two phases in one call:
  //   (1) DECODE the source — fully reverse-engineer WHY it worked from its real material
  //       (full 正文, every image, tags, 互动量, top comments): its 标题模板/封面模板/正文模板/
  //       互动模板/标签模板 and the hooks that drove engagement.
  //   (2) PRODUCE our own version by 结构级复刻 (keep theme + 互动机制 + 信息层级 + body rhythm),
  //       explicitly NOT 文本级抄袭 — replace every concrete word/example, NEVER reuse the
  //       source images (cover prompt is style/色调/信息分层 only).
  const REMIX_SYS = [
    "You are a Xiaohongshu (小红书) 爆款 content strategist. You are given the FULL material of",
    "ONE high-performing source note (its 正文, every image, tags, 互动量, top comments). Do TWO",
    "things and return them as ONE JSON object.",
    "",
    "PHASE 1 — decode: reverse-engineer WHY this note worked, grounded in the real material:",
    "  titlePattern         -> the title 句式/公式 (year? 动作词? 数字? 悬念? 痛点?).",
    "  coverPattern         -> the cover design logic: 是否大字报, 主文案信息层级, 配色/风格 (infer",
    "                          from the image URLs/count + 正文 + niche), 第一张图承担什么.",
    "  bodyStructure        -> the 正文 skeleton: 开场钩子 → 段落职能 → 结尾 CTA.",
    "  interactionMechanism -> what makes people comment/save (评论区打卡/站队/提问/对号入座/收藏型干货).",
    "  hooks                -> 2–5 concrete 传播钩子 you can see firing (from title/正文/评论).",
    "  whyItWorks           -> 1–2 sentence synthesis.",
    "",
    "PHASE 2 — produce our own note (结构级复刻 of the decode, NOT a copy):",
    "  titles  -> EXACTLY 3 candidate titles (Chinese). At least one MUST be <= 20 characters.",
    "  body    -> one publishable 正文 (Chinese), 300–600 字, light line breaks, real-person voice",
    "             with a concrete detail/number/场景 (anti-AI), ending on a 1-sentence 互动 CTA",
    "             that reuses the source's interactionMechanism. NEVER copy a source sentence.",
    "  cover   -> { main, sub, prompt }: main = 封面大字报主文案 (<= 12 chars); sub = 副文案 (<= 18);",
    "             prompt = ONE Chinese 文生图 prompt reproducing the coverPattern's STRUCTURE",
    "             (信息层级/色调/竖版3:4) only — explicitly forbid copying the source's元素/人物/构图.",
    "  images  -> match the source's image COUNT (3–9). Each { caption, prompt }: caption = 该图",
    "             图解文案; prompt = its 文生图 prompt. Mirror the source's图组职能 (封面→步骤→对比→效果…).",
    "  topics  -> 5 to 8 话题 strings WITHOUT the leading # — reuse the source's strong tags +",
    "             a couple of niche 长尾.",
    "",
    "Stay in the operator's 账号定位/赛道 when provided. No 链接/域名, no 引战/虚假承诺/医疗财务夸大.",
    "Return the JSON object ONLY — no prose, no markdown, no code fences.",
  ].join("\n");

  const DECODE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["titlePattern", "coverPattern", "bodyStructure", "interactionMechanism", "hooks", "whyItWorks"],
    properties: {
      titlePattern: { type: "string" },
      coverPattern: { type: "string" },
      bodyStructure: { type: "string" },
      interactionMechanism: { type: "string" },
      hooks: { type: "array", items: { type: "string" } },
      whyItWorks: { type: "string" },
    },
  };
  const REMIX_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["decode", "titles", "body", "cover", "images", "topics"],
    properties: {
      decode: DECODE_SCHEMA,
      titles: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
      body: { type: "string" },
      cover: {
        type: "object",
        additionalProperties: false,
        required: ["main", "sub", "prompt"],
        properties: { main: { type: "string" }, sub: { type: "string" }, prompt: { type: "string" } },
      },
      images: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["caption", "prompt"],
          properties: { caption: { type: "string" }, prompt: { type: "string" } },
        },
      },
      topics: { type: "array", items: { type: "string" } },
    },
  };

  /**
   * generateRemix(dossier, ctx, ai) — run the deep Viral Copy flow on a FULL source dossier
   * (opened + decomposed by the background: full 正文, every image, tags, 互动量, top comments)
   * and return the raw parsed { decode, titles, body, cover, images, topics } object. Mirrors
   * generatePlanSet's call pattern (strict json_schema → json_object fallback).
   * @param {{noteId?:string,title?:string,desc?:string,type?:string,images?:string[],tags?:string[],
   *          likes?:number,collects?:number,comments?:number,shares?:number,
   *          topComments?:{content:string,likeCount?:number}[]}} dossier
   * @param {{niche?:string,coverAnalysis?:string}} ctx  operator's 账号定位 + optional vision read
   * @param {{endpoint:string,model:string,apiKey:string}} ai
   * @returns {Promise<object>} raw (un-normalized) remix object incl. `decode`
   */
  async function generateRemix(dossier, ctx, ai) {
    if (!dossier) throw new Error("no source dossier");
    if (!ai || !ai.apiKey) throw new Error("No API key configured — run the key-install command, then reload the extension");
    const n = dossier || {};
    const c = ctx || {};
    const fmt = (x) => (x == null ? "?" : String(x));

    const parts = ["来源爆款笔记 · 完整拆解材料（学习其结构，严禁照抄文字、严禁复用其图片）："];
    parts.push("标题：" + (n.title || "(无标题)"));
    parts.push("类型：" + (n.type === "video" ? "视频" : "图文"));
    if (n.desc) parts.push("正文全文：\n" + n.desc);
    const imgs = (n.images || []).filter(Boolean);
    if (imgs.length) {
      parts.push("图片共 " + imgs.length + " 张（URL 仅供你判断图组职能/信息层级，不要照搬元素）：");
      imgs.slice(0, 9).forEach((u, i) => parts.push("  图" + (i + 1) + ": " + u));
    }
    if (n.tags && n.tags.length) parts.push("话题标签：" + n.tags.map((t) => "#" + t).join(" "));
    parts.push("互动量：赞 " + fmt(n.likes) + " · 藏 " + fmt(n.collects) + " · 评 " + fmt(n.comments) + " · 分享 " + fmt(n.shares));
    const tc = (n.topComments || []).filter((x) => x && x.content);
    if (tc.length) {
      parts.push("高赞评论（读者最在意什么 + 评论区互动机制的证据）：");
      tc.slice(0, 10).forEach((x) => parts.push("  · (赞" + fmt(x.likeCount) + ") " + x.content));
    }
    if (c.coverAnalysis) parts.push("封面视觉分析（来自图像识别）：" + c.coverAnalysis);
    if (c.niche) parts.push("我的账号定位/赛道：" + c.niche);
    parts.push("请先 decode 这篇为什么爆，再产出我方的新版本（结构级复刻，非照抄）。");

    const base = {
      model: ai.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: REMIX_SYS },
        { role: "user", content: parts.join("\n") },
      ],
    };

    let content;
    try {
      content = await callLLM(ai, {
        ...base,
        response_format: { type: "json_schema", json_schema: { name: "xhs_remix", strict: true, schema: REMIX_SCHEMA } },
      });
    } catch (e) {
      content = await callLLM(ai, { ...base, response_format: { type: "json_object" } });
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new Error("LLM returned non-JSON");
    }
  }

  // analyzeCover(imageUrls, ai) — OPTIONAL vision pass that reverse-engineers the source's
  // cover/product design (信息层级/配色/构图/大字报文案/产品). Best-effort: many text-only
  // endpoints reject image content → returns "" (never throws) and the remix proceeds from
  // the rich text dossier alone. Sends OpenAI-style multimodal content parts (image_url).
  async function analyzeCover(imageUrls, ai) {
    if (!ai || !ai.apiKey) return "";
    const urls = (imageUrls || []).filter(Boolean).slice(0, 3);
    if (!urls.length) return "";
    const userContent = [
      { type: "text", text: "这是一篇小红书爆款笔记的封面/配图。请逆向分析其视觉设计：信息层级、是否大字报及主文案、配色与风格、构图、是否突出某个产品。3-5 句中文，只描述结构与风格，便于我复刻设计逻辑（不复用元素）。" },
      ...urls.map((u) => ({ type: "image_url", image_url: { url: u } })),
    ];
    try {
      const raw = await callLLM(ai, {
        model: ai.model,
        temperature: 0.4,
        messages: [{ role: "user", content: userContent }],
      });
      return String(raw || "").replace(/\s+/g, " ").trim().slice(0, 400);
    } catch {
      return ""; // model not multimodal / image fetch blocked — degrade to text-only remix
    }
  }

  NS.planner = { generatePlan, generatePlanSet, generateComment, generateRemix, analyzeCover };
})();
