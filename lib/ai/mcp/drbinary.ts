import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "@/types";

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

const MCP_PROTOCOL_VERSION = "2026-07-28";
const DEFAULT_MCP_URL = "https://mcp.drbinary.ai/mcp";
const DEFAULT_TIMEOUT_MS = 600_000;

let nextRequestId = 1;
let sessionId: string | undefined;
let initialized = false;
let initializePromise: Promise<void> | undefined;

const getTimeoutMs = () => {
  const raw = Number.parseInt(process.env.DRBINARY_MCP_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const getHeaders = (): Headers => {
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

const getUrl = () => process.env.DRBINARY_MCP_URL?.trim() || DEFAULT_MCP_URL;

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit) => {
  const timeout = AbortSignal.timeout(getTimeoutMs());
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
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

const send = async (
  method: string,
  params: Record<string, unknown> = {},
): Promise<JsonRpcResponse> => {
  const id = nextRequestId++;
  const response = await fetchWithTimeout(getUrl(), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  const returnedSessionId = response.headers.get("mcp-session-id");
  if (returnedSessionId) sessionId = returnedSessionId;

  if (response.status === 401) {
    throw new Error(
      "Dr.Binary MCP authentication is required. Set DRBINARY_MCP_AUTH_TOKEN or complete the provider OAuth flow.",
    );
  }
  if (!response.ok) {
    throw new Error(
      "Dr.Binary MCP HTTP " +
        response.status +
        ": " +
        (await response.text().catch(() => "")).slice(0, 500),
    );
  }

  const message = await parseResponse(response);
  if (message.error) {
    throw new Error(
      "Dr.Binary MCP error " +
        (message.error.code ?? "unknown") +
        ": " +
        (message.error.message ?? "request failed"),
    );
  }
  return message;
};

const sendInitializedNotification = async () => {
  const response = await fetchWithTimeout(getUrl(), {
    method: "POST",
    headers: getHeaders(),
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

const ensureInitialized = async (): Promise<void> => {
  if (initialized) return;
  if (!initializePromise) {
    initializePromise = (async () => {
      await send("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "hackerai-local", version: "1.0.0" },
      });
      await sendInitializedNotification();
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
      await ensureInitialized();
      const response = await send("tools/call", {
        name: operation,
        arguments: args,
      });
      return response.result;
    },
  });
