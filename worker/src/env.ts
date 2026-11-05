import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";

// Secrets live in worker/.env.local (git-ignored) — never in code or the public repo.
const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name} (set it in worker/.env.local)`);
  return v;
}

const ENGINE_HOME = process.env.XHS_ENGINE_HOME || join(homedir(), ".local/share/xiaohongshu-mcp");

export const config = {
  engineUrl: process.env.XHS_MCP_URL || "http://127.0.0.1:18060/mcp",
  engineBin: process.env.XHS_ENGINE_BIN || join(ENGINE_HOME, "v2.7.2-pr906-b02200d/xiaohongshu-mcp"),
  engineState: join(ENGINE_HOME, "state"),
  claudeBin: process.env.CLAUDE_BIN || join(homedir(), ".local/bin/claude"),
  model: process.env.WORKER_MODEL || "claude-haiku-5-5",
  detailsPerRun: Number(process.env.DETAILS_PER_RUN || 8),
  keywordCap: Number(process.env.KEYWORD_CAP || 20),
  candidatesPerRun: Number(process.env.CANDIDATES_PER_RUN || 10),
  maxRunMinutes: Number(process.env.MAX_RUN_MINUTES || 60),
};
