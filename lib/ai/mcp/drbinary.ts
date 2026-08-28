import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "@/types";

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type McpEra = "modern" | "legacy";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_MCP_URL = "https://mcp.drbinary.ai/mcp";
const DEFAULT_TIMEOUT_MS = 600_000;

let nextRequestId = 1;
let sessionId: string | undefined;
let era: McpEra | undefined;
let connectPromise: Promise<void> | undefined;

const getTimeoutMs = () => {
  const raw = Number.parseInt(process.env.DRBINARY_MCP_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const getUrl = () => process.env.DRBINARY_MCP_URL?.trim() || DEFAULT_MCP_URL;

const getCommonHeaders = () => {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  const token = process.env.DRBINARY_MCP_AUTH_TOKEN?.trim();
  if (token) headers.set("authorization", "Bearer " + token);
  const extraHeaders = process.env.DRBINARY_MCP_HEADERS_JSON?.trim();
  if (extraHeaders) {
    const parsed = JSON.parse(extraHeaders) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") headers.set(key, value);
    }
  }
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return headers;
};

const getModernHeaders = (method: string, name?: string) => {
  const headers = getCommonHeaders();
  headers.set("MCP-Protocol-Version", MODERN_PROTOCOL_VERSION);
  headers.set("Mcp-Method", method);
  if (name) headers.set("Mcp-Name", name);
  return headers;
};

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit) => {
  const timeout = AbortSignal.timeout(getTimeoutMs());
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  return fetch(input, { ...init, signal });
};

const parseResponse = async (response: Response): Promise<JsonRpcResponse> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as JsonRpcResponse;
  }

  const text = await response.text();
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  for (let i = dataLines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(dataLines[i]) as JsonRpcResponse;
      if (
        parsed?.id !== undefined ||
        parsed?.result !== undefined ||
        parsed?.error
      ) {
        return parsed;
      }
    } catch {
      // Ignore non-JSON SSE frames.
    }
  }

  throw new Error(
    "Dr.Binary MCP returned an unsupported response: " +
      (contentType || "unknown content type"),
  );
};

const rawRequest = async ({
  method,
  params,
  protocol,
  name,
}: {
  method: string;
  params: Record<string, unknown>;
  protocol: McpEra;
  name?: string;
}) => {
  const id = nextRequestId++;
  const headers =
    protocol === "modern"
      ? getModernHeaders(method, name)
      : getCommonHeaders();

  const response = await fetchWithTimeout(getUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  const returnedSessionId = response.headers.get("mcp-session-id");
  if (returnedSessionId) sessionId = returnedSessionId;

  if (response.status === 401) {
    throw new Error(
      "Dr.Binary MCP authentication is required. Authenticate the MCP session or set DRBINARY_MCP_AUTH_TOKEN.",
    );
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 800);
    const error = new Error(
      `Dr.Binary MCP HTTP ${response.status}: ${detail}`,
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const message = await parseResponse(response);
  if (message.error) {
    const error = new Error(
      `Dr.Binary MCP error ${message.error.code ?? "unknown"}: ${message.error.message ?? "request failed"}`,
    ) as Error & { mcpCode?: number };
    error.mcpCode = message.error.code;
    throw error;
  }
  return message;
};

const initializeLegacy = async () => {
  await rawRequest({
    method: "initialize",
    protocol: "legacy",
    params: {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "hackerai-local", version: "1.0.0" },
    },
  });

  const response = await fetchWithTimeout(getUrl(), {
    method: "POST",
    headers: getCommonHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }),
  });

  if (!response.ok) {
    throw new Error(
      "Dr.Binary MCP initialized notification failed: HTTP " + response.status,
    );
  }
};

const connect = async (): Promise<void> => {
  if (era) return;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      await rawRequest({
        method: "server/discover",
        protocol: "modern",
        params: {},
      });
      era = "modern";
      return;
    } catch (error) {
      if ((error as { status?: number })?.status === 401) throw error;
    }

    await initializeLegacy();
    era = "legacy";
  })().catch((error) => {
    connectPromise = undefined;
    era = undefined;
    sessionId = undefined;
    throw error;
  });

  await connectPromise;
};

const send = async (
  method: string,
  params: Record<string, unknown> = {},
  name?: string,
): Promise<JsonRpcResponse> => {
  await connect();

  if (era === "modern") {
    return rawRequest({
      method,
      name,
      protocol: "modern",
      params: {
        ...params,
        _meta: {
          ...(typeof params._meta === "object" && params._meta !== null
            ? params._meta
            : {}),
          "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientInfo": {
            name: "hackerai-local",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
  }

  return rawRequest({
    method,
    protocol: "legacy",
    params,
  });
};

export const createDrBinaryTool = (_context: ToolContext) =>
  tool({
    description:
      "Call the Dr.Binary MCP binary-analysis backend. Operations: prepare_upload, inspect_binary, run_sandbox, dump_data, list_files, read_file.",
    inputSchema: z.object({
      operation: z.enum([
        "prepare_upload",
        "inspect_binary",
        "run_sandbox",
        "dump_data",
        "list_files",
        "read_file",
      ]),
      arguments: z.record(z.string(), z.unknown()).default({}),
    }),
    execute: async ({ operation, arguments: args }) => {
      const response = await send(
        "tools/call",
        { name: operation, arguments: args },
        operation,
      );
      return response.result;
    },
  });
