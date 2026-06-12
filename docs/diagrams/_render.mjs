// Render an .excalidraw file to SVG (and PNG) via the public Kroki API.
// Kroki wants the raw diagram source as the POST body (text/plain), NOT an
// application/json request envelope — otherwise it reports "diagram_source must
// not be empty".
// Usage: node _render.mjs <file.excalidraw> [--png]
import { readFileSync, writeFileSync } from "node:fs";

const inPath = process.argv[2];
if (!inPath) {
  console.error("usage: node _render.mjs <file.excalidraw> [--png]");
  process.exit(1);
}
const alsoPng = process.argv.includes("--png");
const raw = readFileSync(inPath, "utf8");

async function render(fmt) {
  const res = await fetch("https://kroki.io/excalidraw/" + fmt, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: raw,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    console.error("Kroki HTTP " + res.status + ": " + buf.toString("utf8").slice(0, 400));
    process.exit(2);
  }
  const out = inPath.replace(/\.excalidraw$/, "." + fmt);
  writeFileSync(out, buf);
  console.log("wrote " + out + " (" + buf.length + " bytes)");
}

await render("svg");
if (alsoPng) await render("png");
