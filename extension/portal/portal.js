// portal.js — Content Studio. Wires the operator loop against the background service worker:
//   Scan (capture today's best notes) → ranked grid → Remix (LLM draft) → review + pre-publish
//   gate → copy fields. Publishing is deliberately NOT wired (manual-gated, higher-risk).
// This is an extension PAGE (chrome.tabs.create), so it talks to the SW via chrome.runtime
// directly. Dependency-free vanilla JS. No frameworks, no bundler.

"use strict";

/* ---------------- background bridge ---------------- */
function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(r || { ok: false, error: "no response from background" });
        }
      });
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message || e) });
    }
  });
}

/* ---------------- helpers ---------------- */
// Compact count formatter, mirrors the backend: ≥1e8 → 亿, ≥1e4 → 万, 1 decimal, strip .0.
function fmtCount(n) {
  n = Number(n) || 0;
  if (n < 0) n = 0;
  const trim = (v) => v.toFixed(1).replace(/\.0$/, "");
  if (n >= 1e8) return trim(n / 1e8) + "亿";
  if (n >= 1e4) return trim(n / 1e4) + "万";
  return String(Math.round(n));
}

// Relative time in Chinese: 刚刚 / N 分钟前 / N 小时前 / N 天前.
function relTime(ts) {
  ts = Number(ts) || 0;
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return "刚刚";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " 分钟前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.floor(h / 24);
  if (d < 30) return d + " 天前";
  const mo = Math.floor(d / 30);
  return mo + " 个月前";
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

async function copy(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text == null ? "" : String(text));
    toast(okMsg || "copied!", "ok");
  } catch (e) {
    toast("copy failed — " + (e && e.message || e), "err");
  }
}

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg, kind) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (kind ? " " + kind : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.className = "toast" + (kind ? " " + kind : "");
    setTimeout(() => { t.hidden = true; }, 220);
  }, 2600);
}

/* ---------------- state + refs ---------------- */
const refs = {};
let scanning = false;

function cacheRefs() {
  refs.niche = document.getElementById("niche");
  refs.scanBtn = document.getElementById("scanBtn");
  refs.scanMeta = document.getElementById("scanMeta");
  refs.hotGrid = document.getElementById("hotGrid");
  refs.hotEmpty = document.getElementById("hotEmpty");
  refs.draftList = document.getElementById("draftList");
  refs.draftEmpty = document.getElementById("draftEmpty");
  refs.pubGate = document.getElementById("pubGate");
}

/* ---------------- hot notes ---------------- */
function setScanMeta(scannedAt) {
  refs.scanMeta.textContent = scannedAt ? "last scanned: " + relTime(scannedAt) : "";
}

function renderHotNotes(notes) {
  clear(refs.hotGrid);
  notes = Array.isArray(notes) ? notes : [];
  if (!notes.length) {
    refs.hotEmpty.hidden = false;
    return;
  }
  refs.hotEmpty.hidden = true;
  for (const note of notes) refs.hotGrid.appendChild(buildHotCard(note));
}

function buildHotCard(note) {
  const card = el("div", "hot-card");

  // cover
  const cover = el("div", "hot-cover");
  const img = document.createElement("img");
  img.referrerPolicy = "no-referrer";
  img.loading = "lazy";
  img.alt = "";
  if (note.coverUrl) {
    img.src = note.coverUrl;
  } else {
    cover.classList.add("broken");
  }
  img.addEventListener("error", () => cover.classList.add("broken"));
  cover.appendChild(img);
  const fb = el("span", "cover-fallback", "🖼");
  cover.appendChild(fb);
  cover.appendChild(el("span", "type-tag", note.type === "video" ? "▶ 视频" : "图文"));
  const score = el("span", "score", "评分 " + Math.round(Number(note.score) || 0));
  cover.appendChild(score);
  card.appendChild(cover);

  // body
  const body = el("div", "hot-body");

  const title = el("p", "hot-title");
  if (note.title) {
    title.textContent = note.title;
  } else {
    title.textContent = "(无标题)";
    title.classList.add("muted");
  }
  body.appendChild(title);

  body.appendChild(el("div", "hot-author", "@" + (note.authorName || "匿名")));

  const stats = el("div", "hot-stats");
  stats.appendChild(statSpan("👍", note.likes));
  stats.appendChild(statSpan("⭐", note.collects));
  stats.appendChild(statSpan("💬", note.comments));
  body.appendChild(stats);

  if (Array.isArray(note.reasons) && note.reasons.length) {
    const chips = el("div", "chips");
    for (const r of note.reasons.slice(0, 4)) chips.appendChild(el("span", "chip", r));
    body.appendChild(chips);
  }

  const actions = el("div", "hot-actions");
  const remixBtn = el("button", "btn primary sm", "✨ Remix");
  remixBtn.addEventListener("click", () => onRemix(note, remixBtn));
  actions.appendChild(remixBtn);
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

function statSpan(ic, n) {
  const s = el("span");
  s.appendChild(el("span", "ic", ic));
  s.appendChild(document.createTextNode(fmtCount(n)));
  return s;
}

async function onScan() {
  if (scanning) return;
  scanning = true;
  refs.scanBtn.classList.add("scanning");
  refs.scanBtn.disabled = true;
  refs.scanMeta.textContent = "scanning…";

  const keywords = (refs.niche.value || "")
    .split(/[\s,，、]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const r = await send({ type: "hs:studio:scan", keywords });

  scanning = false;
  refs.scanBtn.classList.remove("scanning");
  refs.scanBtn.disabled = false;

  if (r && r.ok) {
    renderHotNotes(r.notes);
    setScanMeta(r.scannedAt);
    toast("scan done — " + ((r.notes && r.notes.length) || 0) + " notes", "ok");
  } else {
    setScanMeta(0);
    toast(r && r.error ? r.error : "scan failed", "err");
  }
}

async function onRemix(note, btn) {
  const original = btn.textContent;
  const card = btn.closest(".hot-card");
  btn.disabled = true;
  btn.classList.add("busy");
  if (card) card.classList.add("remixing");

  // The remix now OPENS the source note, extracts content+images+comments, may run a
  // vision pass, then generates — it's slow (~20-40s). Walk the operator through the phases.
  const phases = ["拆解源笔记…", "提取封面 + 评论…", "逆向爆款逻辑…", "✨ 生成新草稿…"];
  let pi = 0;
  const ticker = setInterval(() => {
    pi = Math.min(pi + 1, phases.length - 1);
    btn.textContent = phases[pi];
  }, 6000);
  btn.textContent = phases[0];

  const niche = (refs.niche.value || "").trim();
  const r = await send({ type: "hs:studio:remix", noteId: note.noteId, niche });

  clearInterval(ticker);
  btn.disabled = false;
  btn.classList.remove("busy");
  btn.textContent = original;
  if (card) card.classList.remove("remixing");

  if (r && r.ok && r.draft) {
    prependDraft(r.draft);
    toast("草稿已生成 — 源笔记已完整拆解", "ok");
  } else {
    toast(r && r.error ? r.error : "remix failed", "err");
  }
}

/* ---------------- drafts ---------------- */
function renderDrafts(drafts) {
  clear(refs.draftList);
  drafts = Array.isArray(drafts) ? drafts : [];
  if (!drafts.length) {
    refs.draftEmpty.hidden = false;
    return;
  }
  refs.draftEmpty.hidden = true;
  for (const d of drafts) refs.draftList.appendChild(buildDraftCard(d));
}

function prependDraft(draft) {
  refs.draftEmpty.hidden = true;
  refs.draftList.insertBefore(buildDraftCard(draft), refs.draftList.firstChild);
}

function buildDraftCard(d) {
  const card = el("div", "draft-card");
  card.dataset.id = d.id || "";

  // top bar
  const top = el("div", "draft-top");
  const left = el("div");
  const src = el("div", "draft-src");
  src.appendChild(el("b", null, "remix of "));
  src.appendChild(document.createTextNode(d.sourceTitle || "(无标题)"));
  left.appendChild(src);
  left.appendChild(el("div", "draft-time", relTime(d.createdAt)));
  top.appendChild(left);

  const del = el("button", "btn danger sm", "🗑 delete");
  del.addEventListener("click", () => onDeleteDraft(d.id, card));
  top.appendChild(del);
  card.appendChild(top);

  const wrap = el("div", "draft-body-wrap");

  // reverse-engineering proof — WHY the source worked + the decomposed source dossier.
  // These come FIRST: they show the operator the tool understood the source completely.
  const decodeSec = sectionDecode(d.decode);
  if (decodeSec) wrap.appendChild(decodeSec);
  const sourceSec = sectionSource(d.source);
  if (sourceSec) wrap.appendChild(sourceSec);

  // OUR generated version
  // titles
  wrap.appendChild(sectionTitles(d.titles));
  // cover
  wrap.appendChild(sectionCover(d.cover));
  // body
  wrap.appendChild(sectionBody(d.body));
  // topics
  wrap.appendChild(sectionTopics(d.topics));
  // image plan
  wrap.appendChild(sectionImages(d.images));
  // gate
  wrap.appendChild(sectionGate(d.gate));
  // publish — prepare in 创作中心 (manual-gated)
  wrap.appendChild(sectionPublish(d));

  card.appendChild(wrap);
  return card;
}

// "源笔记拆解 (decode)" — WHY the source worked. Collapsible; the "we understood it" proof.
function sectionDecode(decode) {
  if (!decode) return null;
  const sec = el("div", "dsec");
  const det = document.createElement("details");
  det.open = true;
  const sum = el("summary");
  sum.appendChild(el("span", "sum-ico", "🔬"));
  sum.appendChild(document.createTextNode("源笔记拆解 (decode) — 它为什么爆"));
  sum.appendChild(el("span", "sum-tag", "逆向"));
  det.appendChild(sum);

  const body = el("div", "det-body");

  if (decode.whyItWorks) body.appendChild(el("div", "decode-why", decode.whyItWorks));

  const rows = el("div", "decode-rows");
  const defs = [
    ["标题套路", decode.titlePattern],
    ["封面逻辑", decode.coverPattern],
    ["正文结构", decode.bodyStructure],
    ["互动机制", decode.interactionMechanism],
  ];
  let any = false;
  for (const [label, val] of defs) {
    if (!val) continue;
    any = true;
    const row = el("div", "decode-row");
    row.appendChild(el("span", "dr-lbl", label));
    row.appendChild(el("span", "dr-val", val));
    rows.appendChild(row);
  }
  if (any) body.appendChild(rows);

  const hooks = Array.isArray(decode.hooks) ? decode.hooks.filter(Boolean) : [];
  if (hooks.length) {
    body.appendChild(el("div", "decode-hooks-h", "钩子"));
    const chips = el("div", "chips");
    for (const h of hooks) chips.appendChild(el("span", "chip tag", h));
    body.appendChild(chips);
  }

  det.appendChild(body);
  sec.appendChild(det);
  return sec;
}

// "对标源笔记 (source)" — the decomposed source note, visually reverse-engineered.
function sectionSource(source) {
  if (!source) return null;
  const sec = el("div", "dsec");
  const det = document.createElement("details");
  const sum = el("summary");
  sum.appendChild(el("span", "sum-ico", "🎯"));
  sum.appendChild(document.createTextNode("对标源笔记 (source)"));
  sum.appendChild(el("span", "sum-tag", source.type === "video" ? "视频" : "图文"));
  det.appendChild(sum);

  const body = el("div", "det-body");

  // thumbnail strip of ALL source images (public XHS CDN)
  const imgs = Array.isArray(source.images) ? source.images.filter(Boolean) : [];
  if (imgs.length) {
    const strip = el("div", "src-strip");
    for (const url of imgs) {
      const thumb = el("div", "src-thumb");
      const img = document.createElement("img");
      img.referrerPolicy = "no-referrer";
      img.loading = "lazy";
      img.alt = "";
      img.src = url;
      img.addEventListener("error", () => thumb.remove());
      thumb.appendChild(img);
      strip.appendChild(thumb);
    }
    body.appendChild(strip);
  }

  // title + author
  const meta = el("div", "src-meta");
  if (source.title) meta.appendChild(el("div", "src-title", source.title));
  if (source.authorName) meta.appendChild(el("div", "src-author", "@" + source.authorName));
  if (source.title || source.authorName) body.appendChild(meta);

  // stats line
  const stats = el("div", "src-stats");
  stats.appendChild(srcStat("👍", "赞", source.likes));
  stats.appendChild(srcStat("⭐", "藏", source.collects));
  stats.appendChild(srcStat("💬", "评", source.comments));
  stats.appendChild(srcStat("↗", "分享", source.shares));
  body.appendChild(stats);

  // source tags as #chips
  const tags = Array.isArray(source.tags) ? source.tags.filter(Boolean) : [];
  if (tags.length) {
    const chips = el("div", "chips");
    for (const t of tags) chips.appendChild(el("span", "chip tag", "#" + t));
    body.appendChild(chips);
  }

  // source desc (scrollable)
  if (source.desc) body.appendChild(el("div", "src-desc", source.desc));

  // top comments
  const cmts = Array.isArray(source.topComments) ? source.topComments.filter(Boolean) : [];
  if (cmts.length) {
    const wrap = el("div", "src-comments");
    wrap.appendChild(el("div", "src-comments-h", "高赞评论"));
    for (const c of cmts.slice(0, 5)) {
      const cm = el("div", "src-comment");
      cm.appendChild(el("div", "sc-text", c.content || ""));
      const cmMeta = el("div", "sc-meta");
      cmMeta.appendChild(el("span", "sc-like", "👍 " + fmtCount(c.likeCount)));
      if (c.ipLocation) cmMeta.appendChild(el("span", null, "📍 " + c.ipLocation));
      cm.appendChild(cmMeta);
      wrap.appendChild(cm);
    }
    body.appendChild(wrap);
  }

  det.appendChild(body);
  sec.appendChild(det);
  return sec;
}

function srcStat(ic, label, n) {
  const s = el("span");
  s.appendChild(el("span", "ic", ic));
  s.appendChild(document.createTextNode(fmtCount(n) + " " + label));
  return s;
}

// Publish — prepare the draft into 创作中心 (the extension stops at 发布; the human finishes).
function sectionPublish(d) {
  const sec = el("div", "dsec");
  sec.appendChild(el("div", "dsec-h", "发布 (在创作中心填好)"));

  const actions = el("div", "pub-actions");
  const btn = el("button", "btn publish sm", "🚀 在创作中心填好");
  const panel = el("div");      // inline success panel target
  actions.appendChild(btn);
  sec.appendChild(actions);
  sec.appendChild(panel);

  btn.addEventListener("click", () => onPreparePublish(d, btn, panel));
  return sec;
}

async function onPreparePublish(d, btn, panel) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "打开创作中心…";
  clear(panel);

  const r = await send({ type: "hs:studio:publish:prepare", draftId: d.id });

  btn.disabled = false;
  btn.textContent = original;

  if (!r || !r.ok) {
    toast(r && r.error ? r.error : "prepare failed", "err");
    // refresh the gate (a freq block updates the published count / next-allowed time)
    if (r && r.freq) renderPubGate(r.freq);
    else refreshPubGate();
    return;
  }

  panel.appendChild(buildPublishSuccess(r));
  toast("已在创作中心填好 — 请手动选话题并点发布", "ok");
  refreshPubGate();
}

function buildPublishSuccess(r) {
  const p = el("div", "pub-success");

  const head = el("div", "ps-head");
  head.appendChild(el("span", null, "✓"));
  head.appendChild(el("span", null, "创作中心已填好 — 扩展就此停手，发布由你点"));
  p.appendChild(head);

  // readback (标题 N字 / 正文 N字)
  const rb = r.readback || {};
  const rbRow = el("div", "pub-readback");
  rbRow.appendChild(el("span", "rb", "标题 " + (rb.titleLen != null ? rb.titleLen : "—") + " 字"));
  rbRow.appendChild(el("span", "rb", "正文 " + (rb.bodyLen != null ? rb.bodyLen : "—") + " 字"));
  p.appendChild(rbRow);

  // cover status
  const coverStr = typeof r.cover === "string" ? r.cover : (r.cover && r.cover.status);
  if (coverStr) p.appendChild(el("div", "pub-cover-status", "封面：" + coverStr));

  // suggested topics with copy-all
  const topics = Array.isArray(r.topics) ? r.topics.filter(Boolean) : [];
  if (topics.length) {
    const row = el("div", "pub-topics-row");
    const cp = el("button", "btn copy sm", "copy 话题");
    cp.addEventListener("click", () => copy(topics.map((t) => "#" + t).join(" "), "topics copied"));
    row.appendChild(cp);
    const chips = el("div", "chips");
    for (const t of topics) chips.appendChild(el("span", "chip tag", "#" + t));
    row.appendChild(chips);
    p.appendChild(row);
  }

  // instructions VERBATIM — the human-finishes contract
  if (r.instructions) {
    const ins = el("div", "pub-instructions");
    ins.appendChild(el("span", "pi-h", "下一步（手动）"));
    ins.appendChild(document.createTextNode(r.instructions));
    p.appendChild(ins);
  }

  return p;
}

function sectionTitles(titles) {
  const sec = el("div", "dsec");
  sec.appendChild(el("div", "dsec-h", "标题候选 (3)"));
  (Array.isArray(titles) ? titles : []).forEach((t) => {
    const row = el("div", "title-row");
    row.appendChild(el("span", "t-txt", t || ""));
    const len = [...String(t || "")].length;
    const tag = el("span", len <= 20 ? "len-ok" : "len-bad", len <= 20 ? len + "字 ✓" : len + "字");
    row.appendChild(tag);
    const cp = el("button", "btn copy sm", "copy");
    cp.addEventListener("click", () => copy(t, "title copied"));
    row.appendChild(cp);
    sec.appendChild(row);
  });
  return sec;
}

function sectionCover(cover) {
  cover = cover || {};
  const sec = el("div", "dsec");
  sec.appendChild(el("div", "dsec-h", "封面文案 (大字报)"));
  const box = el("div", "cover-box");
  if (cover.main) box.appendChild(el("div", "cover-main", cover.main));
  if (cover.sub) box.appendChild(el("div", "cover-sub", cover.sub));
  const cpRow = el("div", "body-tools");
  const cpText = el("button", "btn copy sm", "copy 文案");
  cpText.addEventListener("click", () => copy([cover.main, cover.sub].filter(Boolean).join("\n"), "cover text copied"));
  cpRow.appendChild(cpText);
  box.appendChild(cpRow);
  sec.appendChild(box);

  if (cover.prompt) {
    const pr = el("div", "prompt-row");
    pr.appendChild(el("span", "p-lbl", "文生图:"));
    pr.appendChild(el("span", "p-txt", cover.prompt));
    const cp = el("button", "btn copy sm", "copy");
    cp.addEventListener("click", () => copy(cover.prompt, "prompt copied"));
    pr.appendChild(cp);
    sec.appendChild(pr);
  }
  return sec;
}

function sectionBody(bodyText) {
  const sec = el("div", "dsec");
  sec.appendChild(el("div", "dsec-h", "正文"));
  const box = el("div", "body-box");
  box.textContent = bodyText || "";
  sec.appendChild(box);

  const tools = el("div", "body-tools");
  const cp = el("button", "btn copy sm", "copy 正文");
  cp.addEventListener("click", () => copy(bodyText, "body copied"));
  tools.appendChild(cp);

  const expand = el("button", "btn sm", "expand");
  expand.addEventListener("click", () => {
    const on = box.classList.toggle("expanded");
    expand.textContent = on ? "collapse" : "expand";
  });
  tools.appendChild(expand);
  sec.appendChild(tools);
  return sec;
}

function sectionTopics(topics) {
  topics = Array.isArray(topics) ? topics.filter(Boolean) : [];
  const sec = el("div", "dsec");
  const head = el("div", "dsec-head-row");
  head.appendChild(el("div", "dsec-h", "话题标签"));
  if (topics.length) {
    const cp = el("button", "btn copy sm", "copy all");
    cp.addEventListener("click", () => copy(topics.map((t) => "#" + t).join(" "), "topics copied"));
    head.appendChild(cp);
  }
  sec.appendChild(head);

  if (!topics.length) {
    sec.appendChild(el("div", "chips", "—"));
    return sec;
  }
  const chips = el("div", "chips");
  for (const t of topics) chips.appendChild(el("span", "chip tag", "#" + t));
  sec.appendChild(chips);
  return sec;
}

function sectionImages(images) {
  images = Array.isArray(images) ? images : [];
  const sec = el("div", "dsec");
  sec.appendChild(el("div", "dsec-h", "配图计划 (" + images.length + ")"));
  if (!images.length) {
    sec.appendChild(el("div", "chips", "—"));
    return sec;
  }
  const list = el("div", "img-plan");
  images.forEach((im, i) => {
    im = im || {};
    const item = el("div", "img-item");
    item.appendChild(el("span", "idx", String(i + 1)));
    const txt = el("div", "img-txt");
    if (im.caption) txt.appendChild(el("div", "img-cap", im.caption));
    if (im.prompt) txt.appendChild(el("div", "img-prompt", im.prompt));
    item.appendChild(txt);
    if (im.prompt) {
      const cp = el("button", "btn copy sm", "copy");
      cp.addEventListener("click", () => copy(im.prompt, "image prompt copied"));
      item.appendChild(cp);
    }
    list.appendChild(item);
  });
  sec.appendChild(list);
  return sec;
}

function sectionGate(gate) {
  gate = gate || {};
  const sec = el("div", "dsec");
  sec.appendChild(el("div", "dsec-h", "发布门禁 (pre-publish gate)"));

  const pass = !!gate.ok;
  const banner = el("div", "gate-banner " + (pass ? "ok" : "fail"));
  banner.appendChild(el("span", null, pass ? "✓" : "!"));
  banner.appendChild(el("span", null, pass ? "门禁通过 — 可手动发布" : "未达发布门禁"));
  sec.appendChild(banner);

  const items = el("div", "gate-items");
  const defs = [
    ["title", "标题", gate.title],
    ["body", "正文", gate.body],
    ["topics", "话题", gate.topics],
    ["antiAi", "去AI味", gate.antiAi],
  ];
  for (const [, label, g] of defs) {
    if (!g) continue;
    const ok = !!g.pass;
    const row = el("div", "gate-item " + (ok ? "pass" : "fail"));
    row.appendChild(el("span", "mark", ok ? "✓" : "✗"));
    row.appendChild(el("span", "g-lbl", label));
    row.appendChild(el("span", "g-detail", g.detail || (ok ? "通过" : "未通过")));
    items.appendChild(row);
  }
  sec.appendChild(items);
  return sec;
}

async function onDeleteDraft(id, card) {
  const r = await send({ type: "hs:studio:draft:delete", id });
  if (r && r.ok) {
    card.remove();
    if (!refs.draftList.children.length) refs.draftEmpty.hidden = false;
    toast("draft deleted", "ok");
  } else {
    toast(r && r.error ? r.error : "delete failed", "err");
  }
}

/* ---------------- publish gate tile ---------------- */
// Render the 发布门禁 status from a {todayCount, max, nextAllowedAt, lastPreparedAt} shape.
function renderPubGate(s) {
  s = s || {};
  const gate = refs.pubGate;
  if (!gate) return;
  clear(gate);

  const todayCount = Number(s.todayCount) || 0;
  const max = Number(s.max) || 0;
  const nextAt = Number(s.nextAllowedAt) || 0;
  const now = Date.now();
  const blocked = (max && todayCount >= max) || (nextAt && nextAt > now);

  gate.classList.toggle("ready", !blocked);
  gate.classList.toggle("blocked", !!blocked);

  // state line
  const state = el("div", "pg-state");
  state.appendChild(el("span", null, blocked ? "⏳" : "✅"));
  state.appendChild(el("span", null, blocked ? "暂缓发布（错峰）" : "可以发布"));
  gate.appendChild(state);

  // today count + bar
  const count = el("div", "pg-count");
  const bar = el("div", "pg-bar");
  const fill = el("i");
  fill.style.width = (max ? Math.min(100, Math.round((todayCount / max) * 100)) : 0) + "%";
  bar.appendChild(fill);
  count.appendChild(bar);
  count.appendChild(el("span", "pg-num", "今日已准备 " + todayCount + "/" + (max || "—") + " 篇"));
  gate.appendChild(count);

  // next-allowed time (relative + absolute clock)
  if (nextAt && nextAt > now) {
    const next = el("div", "pg-next");
    next.appendChild(document.createTextNode("下次可发布："));
    next.appendChild(el("b", null, relTime(nextAt)));
    next.appendChild(document.createTextNode("（" + fmtClock(nextAt) + "）"));
    gate.appendChild(next);
  } else if (s.lastPreparedAt) {
    const last = el("div", "pg-next");
    last.appendChild(document.createTextNode("上次准备："));
    last.appendChild(el("b", null, relTime(s.lastPreparedAt)));
    gate.appendChild(last);
  }
}

// Absolute clock HH:MM (today) or M月D日 HH:MM (other day).
function fmtClock(ts) {
  ts = Number(ts) || 0;
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return hm;
  return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + hm;
}

async function refreshPubGate() {
  const r = await send({ type: "hs:studio:publish:status" });
  if (r && r.ok) {
    renderPubGate(r);
  } else if (refs.pubGate && !refs.pubGate.children.length) {
    renderPubGate({});
  }
}

/* ---------------- init ---------------- */
async function init() {
  cacheRefs();
  refs.scanBtn.addEventListener("click", onScan);
  refs.niche.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onScan(); }
  });

  // load cached hot notes + drafts + publish-gate status in parallel
  const [hot, drafts, pub] = await Promise.all([
    send({ type: "hs:studio:hot" }),
    send({ type: "hs:studio:drafts" }),
    send({ type: "hs:studio:publish:status" }),
  ]);

  if (hot && hot.ok) {
    renderHotNotes(hot.notes);
    setScanMeta(hot.scannedAt);
  } else {
    renderHotNotes([]);
  }

  if (drafts && drafts.ok) {
    renderDrafts(drafts.drafts);
  } else {
    renderDrafts([]);
  }

  if (pub && pub.ok) {
    renderPubGate(pub);
  } else {
    renderPubGate({});
  }

  console.info("[hs] content studio ready");
}

document.addEventListener("DOMContentLoaded", init);
