// Haiku 5.5 through Claude Code's print mode (uses the operator's Claude Code login; no API key).
// No tools, no MCP servers, neutral cwd — the model only reads the prompt and returns schema-valid JSON.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./env.ts";

const cwd = mkdtempSync(join(tmpdir(), "hs-worker-llm-"));

export async function haiku<T>(prompt: string, schema: object, timeoutMs = 240_000): Promise<{ data: T; costUsd: number }> {
  const args = [
    "-p", "--model", config.model, "--output-format", "json",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--tools", "", "--no-session-persistence",
    "--json-schema", JSON.stringify(schema),
  ];
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(config.claudeBin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("haiku timed out")); }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(stdout) : reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
    });
    child.stdin.end(prompt);
  });
  const res = JSON.parse(out);
  if (res.is_error || !res.structured_output) throw new Error("haiku: " + String(res.result || "no structured output").slice(0, 300));
  return { data: res.structured_output as T, costUsd: Number(res.total_cost_usd || 0) };
}
