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
  if (!content.includes(needle)) {
    throw new Error(`Expected marker not found in ${file}: ${needle}`);
  }
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
  [
    '    "ask-model": or(GROK_4_6_SLUG),',
    '    "ask-model": localOllamaEnabled ? localOllama(localOllamaModelName) : or(GROK_4_6_SLUG),',
  ],
  [
    '    "ask-model-free": or(freeAskDeepSeekSlug),',
    '    "ask-model-free": localOllamaEnabled ? localOllama(localOllamaModelName) : or(freeAskDeepSeekSlug),',
  ],
  [
    '    "agent-model": or(GROK_4_6_SLUG),',
    '    "agent-model": localOllamaEnabled ? localOllama(localOllamaModelName) : or(GROK_4_6_SLUG),',
  ],
  [
    '    "agent-model-free": or(freeAgentDeepSeekSlug),',
    '    "agent-model-free": localOllamaEnabled ? localOllama(localOllamaModelName) : or(freeAgentDeepSeekSlug),',
  ],
  [
    '    "fallback-agent-model": or(GROK_4_6_SLUG),',
    '    "fallback-agent-model": localOllamaEnabled ? localOllama(localOllamaModelName) : or(GROK_4_6_SLUG),',
  ],
  [
    '    "fallback-ask-model": or(GROK_4_6_SLUG),',
    '    "fallback-ask-model": localOllamaEnabled ? localOllama(localOllamaModelName) : or(GROK_4_6_SLUG),',
  ],
];
for (const [from, to] of routeReplacements) {
  if (providers.includes(from)) providers = providers.replace(from, to);
}

const tierMarker = 'export function resolveTierToProviderKey(\n  tier: SelectedModel,\n  _mode: ChatMode,\n): ModelName | null {\n  if (tier === "auto") return null;\n';
if (!providers.includes('const LOCAL_MODEL_TIER_ROUTING')) {
  providers = replaceOnce(
    providers,
    tierMarker,
    'const LOCAL_MODEL_TIER_ROUTING = new Set<SelectedModel>([\n  "hackerai-standard",\n  "hackerai-pro",\n  "hackerai-max",\n]);\n\nexport function resolveTierToProviderKey(\n  tier: SelectedModel,\n  _mode: ChatMode,\n): ModelName | null {\n  if (tier === "auto") return null;\n  if (\n    localOllamaEnabled &&\n    LOCAL_MODEL_TIER_ROUTING.has(tier)\n  ) {\n    return _mode === "agent" ? "agent-model" : "ask-model";\n  }\n',
    "lib/ai/providers.ts",
  );
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

write(
  "lib/ai/mcp/drbinary.ts",
  `import { tool } from "ai";\nimport { z } from "zod";\nimport type { ToolContext } from "@/types";\n\ntype JsonRpcResponse = {\n  id?: number;\n  result?: unknown;\n  error?: { code?: number; message?: string; data?: unknown };\n};\n\nconst MCP_PROTOCOL_VERSION = "2026-07-28";\nconst DEFAULT_MCP_URL = "https://mcp.deepbits.com/mcp";\n\nlet nextRequestId = 1;\nlet sessionId: string | undefined;\nlet initialized = false;\nlet initializePromise: Promise<void> | undefined;\n\nconst getHeaders = (): Headers => {\n  const headers = new Headers({\n    "content-type": "application/json",\n    accept: "application/json, text/event-stream",\n  });\n  const token = process.env.DRBINARY_MCP_AUTH_TOKEN?.trim();\n  if (token) headers.set("authorization", `Bearer ${token}`);\n\n  const extraHeaders = process.env.DRBINARY_MCP_HEADERS_JSON?.trim();\n  if (extraHeaders) {\n    try {\n      const parsed = JSON.parse(extraHeaders) as Record<string, unknown>;\n      for (const [key, value] of Object.entries(parsed)) {\n        if (typeof value === "string") headers.set(key, value);\n      }\n    } catch {\n      throw new Error("DRBINARY_MCP_HEADERS_JSON must contain a JSON object of string values.");\n    }\n  }\n  if (sessionId) headers.set("mcp-session-id", sessionId);\n  return headers;\n};\n\nconst getUrl = () =>\n  process.env.DRBINARY_MCP_URL?.trim() || DEFAULT_MCP_URL;\n\nconst parseResponse = async (response: Response): Promise<JsonRpcResponse> => {\n  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";\n  if (contentType.includes("application/json")) {\n    return (await response.json()) as JsonRpcResponse;\n  }\n\n  const text = await response.text();\n  const dataLines = text\n    .split(/\\r?\\n/)\n    .filter((line) => line.startsWith("data:"))\n    .map((line) => line.slice(5).trim())\n    .filter(Boolean);\n\n  for (let i = dataLines.length - 1; i >= 0; i -= 1) {\n    try {\n      const parsed = JSON.parse(dataLines[i]) as JsonRpcResponse;\n      if (parsed?.id !== undefined || parsed?.result !== undefined || parsed?.error) {\n        return parsed;\n      }\n    } catch {\n      // Ignore non-JSON SSE frames.\n    }\n  }\n\n  throw new Error(\n    `Dr.Binary MCP returned an unsupported response (${contentType || "unknown content type"}).`,\n  );\n};\n\nconst send = async (method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> => {\n  const id = nextRequestId++;\n  const response = await fetch(getUrl(), {\n    method: "POST",\n    headers: getHeaders(),\n    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),\n  });\n\n  const returnedSessionId = response.headers.get("mcp-session-id");\n  if (returnedSessionId) sessionId = returnedSessionId;\n\n  if (response.status === 401) {\n    throw new Error(\n      "Dr.Binary MCP authentication is required. Set DRBINARY_MCP_AUTH_TOKEN, or complete the provider's OAuth login and supply the resulting access token.",\n    );\n  }\n  if (!response.ok) {\n    const detail = await response.text().catch(() => "");\n    throw new Error(\n      `Dr.Binary MCP HTTP ${response.status}: ${detail.slice(0, 500)}`,\n    );\n  }\n\n  const message = await parseResponse(response);\n  if (message.error) {\n    throw new Error(\n      `Dr.Binary MCP error ${message.error.code ?? "unknown"}: ${message.error.message ?? "request failed"}`,\n    );\n  }\n  return message;\n};\n\nconst ensureInitialized = async (): Promise<void> => {\n  if (initialized) return;\n  if (!initializePromise) {\n    initializePromise = (async () => {\n      await send("initialize", {\n        protocolVersion: MCP_PROTOCOL_VERSION,\n        capabilities: {},\n        clientInfo: { name: "hackerai-local", version: "1.0.0" },\n      });\n      await fetch(getUrl(), {\n        method: "POST",\n        headers: getHeaders(),\n        body: JSON.stringify({\n          jsonrpc: "2.0",\n          method: "notifications/initialized",\n          params: {},\n        }),\n      });\n      initialized = true;\n    })().catch((error) => {\n      initializePromise = undefined;\n      sessionId = undefined;\n      throw error;\n    });\n  }\n  await initializePromise;\n};\n\nexport const createDrBinaryTool = (_context: ToolContext) =>\n  tool({\n    description: [\n      "Call a Dr.Binary MCP binary-analysis operation.",\n      "Available operations: prepare_upload, inspect_binary, run_sandbox, dump_data, list_files, read_file.",\n      "Recommended workflow for a local binary: prepare_upload -> run the returned one-time upload command with run_terminal_cmd -> inspect_binary -> targeted run_sandbox -> dump_data when deeper decompilation is needed -> list_files/read_file for artifacts.",\n      "The binary bytes should be uploaded directly to Dr.Binary; do not paste large binaries into the model context.",\n    ].join(" "),\n    inputSchema: z.object({\n      operation: z.enum([\n        "prepare_upload",\n        "inspect_binary",\n        "run_sandbox",\n        "dump_data",\n        "list_files",\n        "read_file",\n      ]),\n      arguments: z.record(z.string(), z.unknown()).default({}),\n    }),\n    execute: async ({ operation, arguments: args }) => {\n      await ensureInitialized();\n      const response = await send("tools/call", {\n        name: operation,\n        arguments: args,\n      });\n      return response.result;\n    },\n  });\n`,
);

write(
  ".agents/skills/binary-analysis/SKILL.md",
  `---\nname: binary-analysis\ndescription: Analyze PE, ELF, Mach-O, firmware, and other binaries using HackerAI tools and the Dr.Binary MCP backend.\n---\n\n# Binary Analysis\n\nUse the Dr.Binary MCP tool for specialist static and dynamic analysis. Prefer evidence from tools over assumptions.\n\n## Workflow\n\n1. For a local sample, call \\`prepare_upload\\` and execute the returned one-time upload command with HackerAI's terminal tool.\n2. Start with \\`inspect_binary\\` to collect file metadata, architecture, sections, imports/exports, symbols, strings, and entrypoints.\n3. Use \\`run_sandbox\\` for targeted Rizin/reverse-engineering commands when the initial triage is insufficient.\n4. Use \\`dump_data\\` when a full Ghidra decompilation/disassembly dump is needed.\n5. Use \\`list_files\\` and \\`read_file\\` to inspect generated artifacts.\n6. Correlate multiple observations before concluding. Clearly separate observed facts from hypotheses.\n\n## Tooling\n\nThe Dr.Binary MCP integration is exposed to the model through one HackerAI tool named \\`drbinary\\`. Its operation field routes to the underlying MCP operation.\n`,
);

for (const file of ["LOCAL-MODEL-MCP-PLAN.md"]) {
  const target = path.join(root, file);
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
}
const obsoleteDir = path.join(root, "scripts/local-mcp");
if (fs.existsSync(obsoleteDir)) fs.rmSync(obsoleteDir, { recursive: true, force: true });

console.log("Applied local Ollama + Dr.Binary MCP integration.");
