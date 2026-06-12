// human.js — humanized interaction primitives (shared global, no imports for zero-build MV3)
//
// Ported from Redaily's verified engine (teardown §7) with ONE deliberate change:
// every delay is JITTERED instead of a fixed sleep(2000). This closes the first
// Tier-1 survival gap (PLAN §11) at the primitive level — every action above
// inherits non-deterministic timing for free.

(function () {
  const NS = (window.__hs = window.__hs || {});
  if (NS.human) return; // injected once

  // randInt(min,max) — inclusive. Matches Redaily's randomInt, now actually used.
  const randInt = (min, max) => Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min);

  // delay(min,max) — jittered pause. Single arg = exact.
  const delay = (min, max) => new Promise((r) => setTimeout(r, max == null ? min : randInt(min, max)));

  // simulateClick(el) — Redaily's exact sequence: mousedown → mouseup → click → focus.
  // Synthetic events are isTrusted:false (unavoidable from a content script); the
  // full sequence is still more realistic than a bare .click(). isTrusted upgrade
  // via chrome.debugger is a later Tier-1 phase (PLAN §5).
  function simulateClick(el) {
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    if (typeof el.click === "function") el.click();
    else el.dispatchEvent(new PointerEvent("click", { bubbles: true }));
    if (typeof el.focus === "function") el.focus();
    return true;
  }

  // scrollIntoViewSmooth(el) — bring a target into view the way Redaily does, then settle.
  async function scrollIntoViewSmooth(el, block = "center") {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block, inline: "nearest" });
    await delay(700, 1600);
  }

  // scrollFeed(steps) — humanized feed scroll: variable distance + a reading dwell
  // between steps, with an occasional small scroll-back (real users overshoot).
  async function scrollFeed(steps = 5) {
    for (let i = 0; i < steps; i++) {
      const dist = randInt(400, 900);
      window.scrollBy({ top: dist, left: 0, behavior: "smooth" });
      await delay(1200, 3200); // reading pause
      if (Math.random() < 0.18) {
        window.scrollBy({ top: -randInt(80, 220), left: 0, behavior: "smooth" });
        await delay(500, 1200);
      }
    }
  }

  // typeText(el, text) — Redaily's flow: execCommand("insertText") with a value/textContent fallback.
  async function typeText(el, text) {
    if (!el) return false;
    el.focus();
    simulateClick(el);
    await delay(200, 600);
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      if ("value" in el) el.value = text;
      else el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    }
    await delay(200, 500);
    return true;
  }

  NS.human = { randInt, delay, simulateClick, scrollIntoViewSmooth, scrollFeed, typeText };
})();
