import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, content) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};
const assertContains = (content, needle, file) => {
  if (!content.includes(needle)) throw new Error(`Expected marker not found in ${file}: ${needle}`);
};
const replaceOnce = (content, from, to, file) => {
  assertContains(content, from, file);
  return content.replace(from, to);
};

let providers = read("lib/ai/providers.ts");

if (!providers.includes('import { createOpenAI } from "@ai-sdk/openai";')) {
  providers = replaceOnce(
    providers,
    'import { createOpenRouter } from "@openrouter/ai-sdk-provider";\n',
    'import { createOpenRouter } from "@openrouter/ai-sdk-provider";\nimport { createOpenAI } from "@ai-sdk/openai";\n',
    "lib/ai/providers.ts",
  );
}

if (!providers.includes("const localOllama = createOpenAI({")) {
  providers = replaceOnce(
    providers,
    'const openrouter = createOpenRouter({\n  fetch: openrouterPatchFetch,\n  headers: openrouterAttributionHeaders,\n});\n',
    'const openrouter = createOpenRouter({\n  fetch: openrouterPatchFetch,\n  headers: openrouterAttributionHeaders,\n});\n\nconst localOllama = createOpenAI({\n  name: "ollama",\n  baseURL: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",\n  apiKey: process.env.OLLAMA_API_KEY ?? "ollama",\n});\n\nconst localOllamaEnabled = process.env.HACKERAI_LOCAL_MODEL === "true";\nconst localOllamaModelName = process.env.OLLAMA_MODEL ?? "hacker-local";\n',
    "lib/ai/providers.ts",
  );
}

const routeReplacements = [
  ['    "ask-model": or(GROK_4_6_SLUG),', '    "ask-model": localOllamaEnabled ? localOllama(localOllamaModelName) : or(GROK_4_6_SLUG),'],
  ['    "ask-model-free": or(freeAskDeepSeekSlug),', '    "ask-model-free": localOllamaEnabled ? localOllama(localOllamaModelName) : or(freeAskDeepSeekSlug),'],
  ['    "agent-model": or(GROK_4_6_SLUG),', '    "agent-model": localOllamaEnabled ? localOllama(localOllamaModelName) : or(GROK_4_6_SLUG),'],
  ['    "agent-model-free": or(freeAgentDeepSeekSlug),', '    "agent-model-free": localOllamaEnabled ? localOllama(localOllamaModelName) : or(freeAgentDeepSeekSlug),'],
  ['    "fallback-agent-model": or(GROK_4_6_SLUG),', '    "fallback-agent-model": localOllamaEnabled ? localOllama(localOllamaModelName) : or(GROK_4_6_SLUG),'],
  ['    "fallback-ask-model": or(GROK_4_6_SLUG),', '    "fallback-ask-model": localOllamaEnabled ? localOllama(localOllamaModelName) : or(GROK_4_6_SLUG),'],
  ['    "model-deepseek-v4-flash-0731": or(DEEPSEEK_V4_FLASH_SLUG),', '    "model-deepseek-v4-flash-0731": localOllamaEnabled ? localOllama(localOllamaModelName) : or(DEEPSEEK_V4_FLASH_SLUG),'],
  ['    "model-deepseek-v4-pro-0813": or(DEEPSEEK_V4_PRO_0813_SLUG),', '    "model-deepseek-v4-pro-0813": localOllamaEnabled ? localOllama(localOllamaModelName) : or(DEEPSEEK_V4_PRO_0813_SLUG),'],
  ['    "model-grok-4.6": or(GROK_4_6_SLUG),', '    "model-grok-4.6": localOllamaEnabled ? localOllama(localOllamaModelName) : or(GROK_4_6_SLUG),'],
];
for (const [from, to] of routeReplacements) {
  if (providers.includes(from)) providers = providers.replace(from, to);
}
write("lib/ai/providers.ts", providers);

let tools = read("lib/ai/tools/index.ts");
if (!tools.includes('import { createDrBinaryTool } from "@/lib/ai/mcp/drbinary";')) {
  tools = replaceOnce(
    tools,
    'import { E2B_COST_PER_MS } from "./utils/e2b-cost";\n',
    'import { E2B_COST_PER_MS } from "./utils/e2b-cost";\nimport { createDrBinaryTool } from "@/lib/ai/mcp/drbinary";\n',
    "lib/ai/tools/index.ts",
  );
}
if (!tools.includes("drbinary: createDrBinaryTool(context),")) {
  tools = replaceOnce(
    tools,
    '      get_terminal_files: createGetTerminalFiles(context),\n',
    '      get_terminal_files: createGetTerminalFiles(context),\n      drbinary: createDrBinaryTool(context),\n',
    "lib/ai/tools/index.ts",
  );
}
write("lib/ai/tools/index.ts", tools);

const drBinarySource = String.raw`import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "@/types";

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

const MCP_PROTOCOL_VERSION = "2026-07-28";
const DEFAULT_MCP_URL = "https://mcp.deepbits.com/mcp";

let nextRequestId = 1;
let sessionId: string | undefined;
let initialized = false;
let initializePromise: Promise<void> | undefined;

const getHeaders = (): Headers => {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  const token = process.env.DRBINARY_MCP_AUTH_TOKEN?.trim();
  if (token) headers.set("authorization", "Bearer " + token);
  const extraHeaders = process.env.DRBINARY_MCP_HEADERS_JSON?.trim();
  if (extraHeaders) {
    const parsed = JSON.parse(extraHeaders);
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") headers.set(key, value);
    }
  }
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return headers;
};

const getUrl = () => process.env.DRBINARY_MCP_URL?.trim() || DEFAULT_MCP_URL;

const parseResponse = async (response: Response): Promise<JsonRpcResponse> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) return (await response.json()) as JsonRpcResponse;
  const text = await response.text();
  const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
  for (let i = dataLines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(dataLines[i]);
      if (parsed?.id !== undefined || parsed?.result !== undefined || parsed?.error) return parsed;
    } catch {}
  }
  throw new Error("Dr.Binary MCP returned an unsupported response: " + (contentType || "unknown content type"));
};

const send = async (method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> => {
  const id = nextRequestId++;
  const response = await fetch(getUrl(), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const returnedSessionId = response.headers.get("mcp-session-id");
  if (returnedSessionId) sessionId = returnedSessionId;
  if (response.status === 401) throw new Error("Dr.Binary MCP authentication is required. Set DRBINARY_MCP_AUTH_TOKEN or complete the provider OAuth flow.");
  if (!response.ok) throw new Error("Dr.Binary MCP HTTP " + response.status + ": " + (await response.text().catch(() => "")).slice(0, 500));
  const message = await parseResponse(response);
  if (message.error) throw new Error("Dr.Binary MCP error " + (message.error.code ?? "unknown") + ": " + (message.error.message ?? "request failed"));
  return message;
};

const ensureInitialized = async (): Promise<void> => {
  if (initialized) return;
  if (!initializePromise) {
    initializePromise = (async () => {
      await send("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "hackerai-local", version: "1.0.0" },
      });
      const response = await fetch(getUrl(), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      });
      if (!response.ok) throw new Error("Dr.Binary MCP initialized notification failed: HTTP " + response.status);
      initialized = true;
    })().catch((error) => {
      initializePromise = undefined;
      sessionId = undefined;
      initialized = false;
      throw error;
    });
  }
  await initializePromise;
};

export const createDrBinaryTool = (_context: ToolContext) =>
  tool({
    description: "Call a Dr.Binary MCP binary-analysis operation. Operations: prepare_upload, inspect_binary, run_sandbox, dump_data, list_files, read_file.",
    inputSchema: z.object({
      operation: z.enum(["prepare_upload", "inspect_binary", "run_sandbox", "dump_data", "list_files", "read_file"]),
      arguments: z.record(z.string(), z.unknown()).default({}),
    }),
    execute: async ({ operation, arguments: args }) => {
      await ensureInitialized();
      const response = await send("tools/call", { name: operation, arguments: args });
      return response.result;
    },
  });
`;
write("lib/ai/mcp/drbinary.ts", drBinarySource);

const skillSource = String.raw`---
name: binary-analysis
description: Analyze PE, ELF, Mach-O, firmware, and other binaries using HackerAI tools and the Dr.Binary MCP backend.
---

# Binary Analysis

Use the Dr.Binary MCP tool for specialist static and dynamic analysis. Prefer evidence from tools over assumptions.

## Workflow

1. For a local sample, call prepare_upload and execute the returned one-time upload command with HackerAI's terminal tool.
2. Start with inspect_binary to collect file metadata, architecture, sections, imports/exports, symbols, strings, and entrypoints.
3. Use run_sandbox for targeted Rizin or reverse-engineering commands when the initial triage is insufficient.
4. Use dump_data when deeper decompilation or disassembly artifacts are needed.
5. Use list_files and read_file to inspect generated artifacts.
6. Correlate multiple observations before concluding and separate observed facts from hypotheses.

The Dr.Binary MCP integration is exposed through the HackerAI tool named drbinary.
`;
write(".agents/skills/binary-analysis/SKILL.md", skillSource);

for (const file of ["LOCAL-MODEL-MCP-PLAN.md"]) {
  const target = path.join(root, file);
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
}
const obsoleteDir = path.join(root, "scripts/local-mcp");
if (fs.existsSync(obsoleteDir)) fs.rmSync(obsoleteDir, { recursive: true, force: true });

console.log("Applied local Ollama + Dr.Binary MCP integration.");
