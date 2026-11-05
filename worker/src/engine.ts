// Client for the local xiaohongshu-mcp engine (upstream, pinned). Starts it if it isn't running.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { spawn } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./env.ts";

const token = () => readFileSync(join(config.engineState, "auth_token"), "utf8").trim();

export class Engine {
  private client: Client | null = null;

  async connect(): Promise<void> {
    const client = new Client({ name: "hs-portal-worker", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.engineUrl), {
        requestInit: { headers: { Authorization: `Bearer ${token()}` } },
      }),
    );
    this.client = client;
  }

  // Tools answer with one text block: JSON on success, a Chinese error sentence on failure.
  async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    if (!this.client) throw new Error("engine not connected");
    const res: any = await this.client.callTool({ name, arguments: args }, { timeout: 180_000 });
    const text = (res.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    if (res.isError) throw new Error(`${name}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => {});
    this.client = null;
  }
}

// Connect to a running engine, or start one (visible window, localhost-only, token auth) and wait for it.
export async function ensureEngine(): Promise<{ engine: Engine; stop: () => void }> {
  const engine = new Engine();
  try {
    await engine.connect();
    return { engine, stop: () => {} };
  } catch {
    /* not running — start it */
  }
  const log = openSync(join(config.engineState, "server.log"), "a");
  const child = spawn(config.engineBin, ["-headless=false", "-port", "127.0.0.1:18060"], {
    cwd: config.engineState,
    env: { ...process.env, COOKIES_PATH: join(config.engineState, "cookies.json"), AUTH_TOKEN: token() },
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await engine.connect();
      return { engine, stop: () => process.kill(child.pid!) };
    } catch {
      /* keep waiting */
    }
  }
  try { process.kill(child.pid!); } catch {}
  throw new Error("engine did not start within 30s — see " + join(config.engineState, "server.log"));
}

// Random human-ish pause between engine calls (research: 5–15s, one call at a time).
export const pause = (minS = 5, maxS = 15) =>
  new Promise((r) => setTimeout(r, (minS + Math.random() * (maxS - minS)) * 1000));
