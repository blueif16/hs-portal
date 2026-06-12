// publisher.js — the MANUAL-GATED creator publish driver for Xiaohongshu.
//
// This is NOT part of the 养号 (engagement) engine. It only PREFILLS the creator publish
// page (https://creator.xiaohongshu.com/publish/publish) so the operator can review and
// publish by hand. It NEVER clicks 发布/提交/publish — that is a hard red line (posting is
// the human's deliberate act; see RISK-MODEL).
//
// Coexistence rules (this file ships on ALL *.xiaohongshu.com pages via the manifest):
//   • SELF-GUARD: it only activates on creator.xiaohongshu.com. On www / edith / anything
//     else it returns immediately and registers NO listeners, so it can never interfere
//     with engine.js / the 养号 engine running on www.xiaohongshu.com.
//   • DISTINCT message type: it answers `type:"hs:pub"`. engine.js owns `type:"hs:action"`.
//     The two listeners never see each other's messages → no clash on a shared page.
//   • Selectors WILL drift — they ALL live in the PSEL map at the top (like engine.js's SEL)
//     plus Chinese-text fallbacks (byText). Tune them in one place, live. Any op that can't
//     find its target returns {ok:false,error:"..."} and NEVER throws.

(function () {
  // ---- self-guard: creator host only ---------------------------------------
  if (location.hostname !== "creator.xiaohongshu.com") return;

  // human.js loads before this file (content_scripts order). Reuse it for human-like pacing
  // and clicks when present; tiny local fallbacks keep this file from hard-depending on it.
  const H = (window.__hs && window.__hs.human) || null;
  const delay = (min, max) =>
    H ? H.delay(min, max) : new Promise((r) => setTimeout(r, max == null ? min : min));
  const clickEl = (el) => (H ? H.simulateClick(el) : el && el.click());
  const randInt = (a, b) => (H ? H.randInt(a, b) : Math.floor((a + b) / 2));

  // ---- DOM map (creator publish page) --------------------------------------
  // EVERY selector here is best-effort and WILL be tuned on the live creator DOM. Each entry
  // pairs a CSS-selector guess with a Chinese-label text fallback (driven by byText) so a
  // class-name change degrades to the text locator instead of breaking the whole flow.
  const PSEL = {
    // any publish-page marker (one of these present ⇒ we're on the publish UI) — verify live
    publishRoot: ".publish-container, .creator-tab, .header-container, .upload-container",

    // note-type tabs. CSS scope to scan, plus the visible Chinese labels — verify live
    tabScope: ".creator-tab .tab, [class*='tab'], .reds-tab-item, [role='tab'], .header-container *",
    imageTextText: ["上传图文", "图文"], // 图文 (image-text) tab labels
    videoText: ["上传视频", "视频"], // 视频 (video) tab labels

    // 文字配图 ("大字报" text-to-cover) entry inside the 图文 panel — verify live
    textImageScope: "[class*='upload'] *, [class*='tab'] *, .creator-tab *, button, .reds-button-new",
    textImageText: ["文字配图"],

    // the cover headline box in the 文字配图 panel: textarea or contenteditable — verify live
    coverTextBox:
      ".text-cover textarea, .cover-text textarea, [class*='cover'] textarea, " +
      "[class*='cover'] [contenteditable='true'], [class*='poster'] textarea, " +
      "[placeholder*='标题'], [placeholder*='文字'], [placeholder*='输入']",
    // optional secondary/sub line in the 文字配图 panel (best-effort) — verify live
    coverSubBox: ".text-cover .sub textarea, [class*='cover'] textarea ~ textarea, [placeholder*='副']",

    // 生成图片 (generate) button — verify live
    generateScope: "button, .reds-button-new, [class*='btn'], [class*='generate']",
    generateText: ["生成图片", "生成"],

    // first template/style card after generating — verify live
    templateItem:
      ".template-item, .style-item, .cover-template *, [class*='template'] [class*='item'], " +
      "[class*='style'] [class*='item'], .cover-list > *",

    // 下一步 (next → editor) button — verify live
    nextScope: "button, .reds-button-new, [class*='btn'], [class*='next']",
    nextText: ["下一步", "下一步"],

    // editor: single-line 标题 input (placeholder contains 标题, max 20 chars) — verify live
    titleInput:
      "input[placeholder*='标题'], .title-input input, .d-text input, " +
      "[class*='title'] input, textarea[placeholder*='标题']",

    // editor: multi-line 正文 body. ProseMirror / tiptap / quill contenteditable — verify live
    bodyEditor:
      "[contenteditable='true'].ql-editor, .ProseMirror, #post-textarea, " +
      "[data-placeholder*='正文'], [placeholder*='正文'], [class*='content'] [contenteditable='true'], " +
      "[contenteditable='true']",

    // 话题/标签 entry — ONLY probed (hasTopicEntry); we NEVER drive it (operator picks tags) — verify live
    topicScope: "button, .reds-button-new, [class*='topic'] *, [class*='tag'] *, .editor *",
    topicText: ["添加话题", "话题"],

    // 发布 button — located only to scroll/highlight; NEVER clicked — verify live
    publishScope: "button.publishBtn, .submit .red, .publish-btn, button, .reds-button-new",
    publishText: ["发布"],
  };

  // ---- utils (mirror engine.js's q/qa/ok/fail style) -----------------------
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const ok = (detail, extra) => Object.assign({ ok: true, detail }, extra || {});
  const fail = (error) => ({ ok: false, error });
  // code-point length (CJK-safe) — "字" counts as 1, surrogate-pair emoji as 1.
  const cpLen = (s) => [...String(s || "")].length;

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") {
      // offsetParent is null for display:none AND for fixed elements; allow fixed through.
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // byText(selectorList, wantText, {max}) — scan candidate elements and return the first VISIBLE
  // one whose trimmed textContent === wantText, else the first that INCLUDES it. Length-bounded
  // (default ≤ wantText.length + max) so we match the actual button/tab, not a huge container
  // that happens to contain the label deep inside. The text fallback for every PSEL locator.
  function byText(selectorList, wantText, opts) {
    const max = (opts && opts.max) || 10;
    const want = String(wantText || "").trim();
    if (!want) return null;
    const limit = want.length + max;
    const cands = qa(selectorList).filter(isVisible);
    // exact-trim match first (most precise), then a bounded "includes" pass.
    let hit = cands.find((el) => (el.textContent || "").trim() === want);
    if (hit) return hit;
    hit = cands.find((el) => {
      const t = (el.textContent || "").trim();
      return t.length <= limit && t.includes(want);
    });
    return hit || null;
  }

  // firstByTexts(scope, labels) — try each label in order, return first hit.
  function firstByTexts(scope, labels, opts) {
    for (const lbl of labels || []) {
      const el = byText(scope, lbl, opts);
      if (el) return el;
    }
    return null;
  }

  function onPublishPage() {
    return (
      location.hostname === "creator.xiaohongshu.com" &&
      /\/publish\/publish/.test(location.pathname) &&
      !!q(PSEL.publishRoot)
    );
  }

  // current note-type mode from which tab looks active. Best-effort heuristic.
  function detectMode() {
    const imgTab = firstByTexts(PSEL.tabScope, PSEL.imageTextText, { max: 6 });
    const vidTab = firstByTexts(PSEL.tabScope, PSEL.videoText, { max: 6 });
    const activeOf = (el) => {
      if (!el) return false;
      const node = el.closest("[class*='tab'],[role='tab']") || el;
      const cls = (node.className || "") + " " + ((node.getAttribute && node.getAttribute("class")) || "");
      return /active|selected|current|checked/i.test(cls) || node.getAttribute("aria-selected") === "true";
    };
    if (activeOf(imgTab)) return "image";
    if (activeOf(vidTab)) return "video";
    return "unknown";
  }

  // ---- text writing (ProseMirror / contenteditable / input) ----------------
  // Write `text` into a field reliably, then read it back. ProseMirror eats .value/.textContent
  // sets, so we focus and use execCommand("insertText"); fall back to a direct set + InputEvent.
  // Returns the read-back string so callers can report length.
  async function writeInto(el, text, { clear = true } = {}) {
    if (!el) return null;
    const editable = el.isContentEditable || el.getAttribute("contenteditable") === "true";
    el.focus();
    await delay(120, 260);
    // clear existing content first (select-all then overwrite).
    if (clear) {
      try {
        if (editable) {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand("delete", false);
        } else if ("value" in el) {
          el.select && el.select();
          el.value = "";
        }
      } catch (e) {
        /* best-effort clear */
      }
    }
    // primary: execCommand insertText (what XHS's editor listens for).
    let wrote = false;
    try {
      wrote = document.execCommand("insertText", false, String(text));
    } catch (e) {
      wrote = false;
    }
    // verify the primary write actually landed; if not, fall back.
    const readBack = () => (editable ? (el.innerText || el.textContent || "") : ("value" in el ? el.value : el.textContent || ""));
    if (!wrote || readBack().trim() === "") {
      try {
        if (editable) el.textContent = String(text);
        else if ("value" in el) el.value = String(text);
        else el.textContent = String(text);
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: String(text) })
        );
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {
        /* best-effort fallback */
      }
    }
    await delay(150, 350);
    return readBack();
  }

  function readTitle() {
    const el = q(PSEL.titleInput);
    if (!el) return "";
    return ("value" in el ? el.value : el.textContent || "").trim();
  }
  function readBody() {
    const el = q(PSEL.bodyEditor);
    if (!el) return "";
    return (el.innerText || el.textContent || "").trim();
  }

  // ---- ops (the dispatch map; each returns a plain object, never throws) ----
  const actions = {
    // pubProbe — diagnostic snapshot of the publish UI so selector drift is unmistakable.
    async pubProbe() {
      const onPage = onPublishPage();
      const hasImageTextTab = !!firstByTexts(PSEL.tabScope, PSEL.imageTextText, { max: 6 });
      const hasTextImage = !!firstByTexts(PSEL.textImageScope, PSEL.textImageText, { max: 6 });
      const hasTitle = !!q(PSEL.titleInput);
      const hasBody = !!q(PSEL.bodyEditor);
      const hasTopicEntry = !!firstByTexts(PSEL.topicScope, PSEL.topicText, { max: 6 });
      const hasPublishBtn = !!firstByTexts(PSEL.publishScope, PSEL.publishText, { max: 6 });
      return ok("probe", {
        probe: {
          onPublishPage: onPage,
          mode: detectMode(),
          hasImageTextTab,
          hasTextImage,
          hasTitle,
          hasBody,
          hasTopicEntry,
          hasPublishBtn,
          title: readTitle(),
          body: readBody(),
        },
      });
    },

    // pubEnsureImageText — switch to 图文 mode (default may be 视频). Click the 图文 tab unless
    // already active. Best-effort: a missing tab on an already-图文 page is non-fatal.
    async pubEnsureImageText() {
      if (!onPublishPage()) return fail("not on publish page");
      if (detectMode() === "image") return ok("already image-text mode");
      const tab = firstByTexts(PSEL.tabScope, PSEL.imageTextText, { max: 6 });
      if (!tab) {
        // can't find the tab but maybe we're already in 图文 (editor present) — don't fail hard.
        if (q(PSEL.titleInput) || q(PSEL.bodyEditor)) return ok("image-text editor already present");
        return fail("图文 tab not found");
      }
      const target = tab.closest("[class*='tab'],[role='tab'],button") || tab;
      target.scrollIntoView({ block: "center" });
      await delay(300, 700);
      clickEl(target);
      await delay(600, 1100);
      return ok("switched to image-text", { mode: detectMode() });
    },

    // pubTextCover — the 文字配图 ("大字报") path: open 文字配图, type the cover headline (and the
    // optional sub line), 生成图片, pick the first template, 下一步 → editor. Every sub-step is
    // best-effort with a short wait. Verifies the editor was reached (title/body now present).
    async pubTextCover({ main, sub } = {}) {
      if (!onPublishPage()) return fail("not on publish page");
      if (!main) return fail("no cover text (main) given");

      // 1) open the 文字配图 panel
      const entry = firstByTexts(PSEL.textImageScope, PSEL.textImageText, { max: 6 });
      if (!entry) return fail("文字配图 entry not found");
      const entryEl = entry.closest("button,[class*='tab'],[class*='item']") || entry;
      entryEl.scrollIntoView({ block: "center" });
      await delay(300, 700);
      clickEl(entryEl);
      await delay(1200, 2000);

      // 2) type the cover headline (+ optional sub line)
      const box = q(PSEL.coverTextBox);
      if (!box) return fail("文字配图 cover-text box not found");
      const wroteMain = await writeInto(box, main);
      await delay(400, 800);
      if (sub) {
        const subBox = q(PSEL.coverSubBox);
        if (subBox && subBox !== box) {
          await writeInto(subBox, sub);
          await delay(300, 600);
        }
      }

      // 3) 生成图片
      const gen = firstByTexts(PSEL.generateScope, PSEL.generateText, { max: 6 });
      if (gen) {
        clickEl(gen.closest("button") || gen);
        await delay(1500, 2500);
      }

      // 4) pick the first template/style
      const tpl = qa(PSEL.templateItem).filter(isVisible)[0];
      if (tpl) {
        tpl.scrollIntoView({ block: "center" });
        await delay(300, 700);
        clickEl(tpl);
        await delay(600, 1200);
      }

      // 5) 下一步 → editor
      const next = firstByTexts(PSEL.nextScope, PSEL.nextText, { max: 6 });
      if (next) {
        clickEl(next.closest("button") || next);
        await delay(1200, 2200);
      }

      // verify we reached the editor
      const reached = !!(q(PSEL.titleInput) || q(PSEL.bodyEditor));
      if (!reached) return fail("did not reach editor after 文字配图 → 下一步 (selector drift?)");
      return ok("text-cover done, editor reached", {
        coverWritten: (wroteMain || "").trim().slice(0, 40),
        clickedGenerate: !!gen,
        pickedTemplate: !!tpl,
        clickedNext: !!next,
      });
    },

    // pubFillTitle — write the 标题 (single-line, ≤ ~20 chars). Read back, report length.
    async pubFillTitle({ text } = {}) {
      if (text == null) return fail("no title text");
      const el = q(PSEL.titleInput);
      if (!el) return fail("title input not found (not in editor?)");
      const back = await writeInto(el, text);
      return ok("title filled", { titleLen: cpLen(back), title: (back || "").trim() });
    },

    // pubFillBody — write the 正文 body (multi-line ok). Read back, report length.
    async pubFillBody({ text } = {}) {
      if (text == null) return fail("no body text");
      const el = q(PSEL.bodyEditor);
      if (!el) return fail("body editor not found (not in editor?)");
      const back = await writeInto(el, text);
      return ok("body filled", { bodyLen: cpLen(back) });
    },

    // pubReadback — read whatever is currently in 标题 / 正文 (for before/after verification).
    async pubReadback() {
      const title = readTitle();
      const body = readBody();
      return ok("readback", { title, titleLen: cpLen(title), body, bodyLen: cpLen(body) });
    },

    // pubFocusPublish — locate the 发布 button, scroll it into view, and add a brief outline
    // highlight so the operator can find it. NEVER clicks it (hard red line). A missing button
    // is non-fatal (returns ok with a detail note) so the prefill flow isn't blocked.
    async pubFocusPublish() {
      const btn = firstByTexts(PSEL.publishScope, PSEL.publishText, { max: 6 });
      if (!btn) return ok("发布 button not found");
      const target = btn.closest("button") || btn;
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        // brief outline highlight (inline style; no click).
        const prev = target.style.outline;
        target.style.outline = "3px solid #ff2442";
        target.style.outlineOffset = "2px";
        setTimeout(() => {
          try {
            target.style.outline = prev || "";
          } catch (e) {}
        }, 4000);
      } catch (e) {
        /* highlight is cosmetic — never fatal */
      }
      return ok("发布 button focused (NOT clicked)");
    },
  };

  async function dispatch(action, args) {
    const fn = actions[action];
    if (!fn) return fail("unknown pub action: " + action);
    return fn(args || {});
  }

  // ---- message bridge (background → content; distinct type "hs:pub") --------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "hs:pub") return; // not ours (engine.js owns "hs:action")
    (async () => {
      try {
        sendResponse(await dispatch(msg.action, msg.args));
      } catch (e) {
        sendResponse(fail(String((e && e.message) || e)));
      }
    })();
    return true; // async sendResponse
  });

  console.info("[hs] publisher ready (creator publish driver)");
})();
