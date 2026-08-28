# Local HackerAI: Ollama + GGUF + Dr.Binary

This fork can run the HackerAI chat/agent against a local Ollama model while keeping the existing HackerAI tools and adding Dr.Binary binary-analysis tools.

## 1. Put the GGUF on the machine

Recommended model for an RTX 5070 12 GB:

- Qwen3-14B-Abliterated GGUF
- start with Q4_K_M

The GGUF is deliberately not stored in git.

Default path expected by the launcher:

`models/qwen3-14b-abliterated-q4_k_m.gguf`

Or set `HACKERAI_GGUF_PATH` to an absolute path.

## 2. Install dependencies

```bash
pnpm install
```

Ollama must also be installed and available as `ollama` on PATH.

## 3. Start

Windows:

```text
start-local.cmd
```

Linux/macOS:

```bash
pnpm exec node scripts/start-local.mjs
```

The launcher:

1. creates `.env.local` from `.env.local.example` when needed;
2. starts Ollama if it is not already running;
3. creates the `hacker-local` Ollama model from the GGUF if it does not exist;
4. forces HackerAI to use the Ollama OpenAI-compatible endpoint;
5. enables Dr.Binary MCP;
6. starts the existing HackerAI local Next.js + Convex development stack.

## 4. Environment

The important values are:

```env
HACKERAI_LOCAL_MODEL=true
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_API_KEY=ollama
OLLAMA_MODEL=hacker-local
DRBINARY_MCP_ENABLED=true
DRBINARY_MCP_URL=https://mcp.drbinary.ai/mcp
DRBINARY_MCP_TIMEOUT_MS=600000
```

## 5. Dr.Binary authentication

Dr.Binary currently exposes a remote MCP server and browser/OAuth sign-in. Its current endpoint is `https://mcp.drbinary.ai/mcp`. The repository integration supports a bearer token through `DRBINARY_MCP_AUTH_TOKEN` and arbitrary extra headers through `DRBINARY_MCP_HEADERS_JSON`.

If the server requires an interactive OAuth session, authenticate the MCP client using the provider's normal sign-in flow and then supply the resulting bearer credential to the local process. The code does not store credentials in git.

## 6. Binary-analysis workflow

In Agent mode the model receives the `drbinary` tool. It can route to:

- `prepare_upload`
- `inspect_binary`
- `run_sandbox`
- `dump_data`
- `list_files`
- `read_file`

The intended workflow is to upload the binary directly to Dr.Binary, collect triage, run targeted sandbox analysis, and inspect the generated artifacts rather than putting binary bytes into the LLM context.

## 7. Local model configuration

`Modelfile.hackerai` is provided as a reference recipe. The launcher generates a temporary Modelfile so the GGUF can live outside the repository.

Default local context is 16K tokens with temperature 0.2. Raise context only after checking VRAM usage on the RTX 5070.
