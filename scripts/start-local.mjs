import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import process from "node:process";
import dotenv from "dotenv";

const root = process.cwd();
const envFile = path.join(root, ".env.local");
const envExample = path.join(root, ".env.local.example");

if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, envFile);
  console.log("Created .env.local from .env.local.example");
}

dotenv.config({ path: envFile, override: false });

const modelName = process.env.OLLAMA_MODEL || "hacker-local";
const ggufPath = path.resolve(
  root,
  process.env.HACKERAI_GGUF_PATH ||
    "models/qwen3-14b-abliterated-q4_k_m.gguf",
);
const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1";
const ollamaApiUrl = ollamaUrl.replace(/\/v1\/?$/, "");

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });

const commandName = process.platform === "win32" ? "ollama.exe" : "ollama";

try {
  execFileSync(commandName, ["--version"], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });
} catch {
  console.error("Ollama is not installed or is not on PATH.");
  console.error("Install Ollama from https://ollama.com/download");
  process.exit(1);
}

const isOllamaRunning = async () => {
  try {
    const response = await fetch(`${ollamaApiUrl}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
};

if (!(await isOllamaRunning())) {
  console.log("Starting Ollama...");
  const ollamaEnv = {
    ...process.env,
    OLLAMA_FLASH_ATTENTION: process.env.OLLAMA_FLASH_ATTENTION || "1",
    OLLAMA_NUM_PARALLEL: process.env.OLLAMA_NUM_PARALLEL || "1",
  };
  const ollamaChild = spawn(commandName, ["serve"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: ollamaEnv,
  });
  ollamaChild.unref();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isOllamaRunning()) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

if (!(await isOllamaRunning())) {
  console.error(`Ollama is not responding at ${ollamaApiUrl}`);
  process.exit(1);
}

let modelList = "";
try {
  modelList = execFileSync(commandName, ["list"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
} catch (error) {
  console.error("Unable to query Ollama models.");
  throw error;
}

const wantedModelId = modelName.split(":")[0];
const modelExists = modelList
  .split(/\r?\n/)
  .slice(1)
  .some((line) => {
    const listedName = line.trim().split(/\s+/)[0];
    return listedName && listedName.split(":")[0] === wantedModelId;
  });

if (!modelExists) {
  if (!fs.existsSync(ggufPath)) {
    console.error(`GGUF model not found: ${ggufPath}`);
    console.error(
      "Set HACKERAI_GGUF_PATH to the full path of your GGUF file, or place it under models/.",
    );
    process.exit(1);
  }

  const generatedModelfile = path.join(root, ".hackerai.local.Modelfile");
  const modelDefinition = [
    `FROM ${ggufPath}`,
    "PARAMETER num_ctx 16384",
    "PARAMETER temperature 0.2",
    "PARAMETER top_p 0.9",
    "SYSTEM You are HackerAI's local agent. Use tools whenever they provide evidence or actions. For binary analysis, investigate systematically and distinguish observations from hypotheses.",
    "",
  ].join("\n");

  fs.writeFileSync(generatedModelfile, modelDefinition, "utf8");
  console.log(`Creating Ollama model '${modelName}' from ${ggufPath}`);
  try {
    run(commandName, ["create", modelName, "-f", generatedModelfile]);
  } finally {
    fs.rmSync(generatedModelfile, { force: true });
  }
}

const childEnv = {
  ...process.env,
  HACKERAI_LOCAL_MODEL: "true",
  OLLAMA_BASE_URL: ollamaUrl,
  OLLAMA_API_KEY: process.env.OLLAMA_API_KEY || "ollama",
  OLLAMA_MODEL: modelName,
  DRBINARY_MCP_ENABLED: process.env.DRBINARY_MCP_ENABLED || "true",
  DRBINARY_MCP_URL:
    process.env.DRBINARY_MCP_URL || "https://mcp.drbinary.ai/mcp",
  DRBINARY_MCP_TIMEOUT_MS: process.env.DRBINARY_MCP_TIMEOUT_MS || "600000",
};

const enableTrigger = /^true$/i.test(
  process.env.HACKERAI_ENABLE_TRIGGER || "false",
);

if (!enableTrigger) {
  delete childEnv.TRIGGER_PROJECT_ID;
  delete childEnv.TRIGGER_SECRET_KEY;
}

delete childEnv.CONVEX_DEPLOYMENT;
delete childEnv.CONVEX_URL;
delete childEnv.NEXT_PUBLIC_CONVEX_URL;

console.log("");
console.log(`HackerAI local model: ${modelName}`);
console.log(`Ollama endpoint: ${ollamaUrl}`);
console.log(`Dr.Binary MCP: ${childEnv.DRBINARY_MCP_URL}`);
console.log(
  `Trigger.dev: ${
    process.env.TRIGGER_PROJECT_ID && process.env.TRIGGER_SECRET_KEY
      ? "available (disabled by default)"
      : "not configured"
  }`,
);
console.log("");

const children = [];

const spawnPnpmWindowsSafe = (args) => {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    return spawn(comspec, ["/d", "/s", "/c", `pnpm.cmd ${args.join(" ")}`], {
      cwd: root,
      env: childEnv,
      stdio: "inherit",
      windowsHide: false,
      shell: false,
    });
  }

  return spawn("pnpm", args, {
    cwd: root,
    env: childEnv,
    stdio: "inherit",
    shell: false,
  });
};

if (enableTrigger) {
  console.log("Starting pnpm run dev:all...");
  children.push(spawnPnpmWindowsSafe(["run", "dev:all"]));
} else {
  console.log("Starting local Next.js + Convex...");
  children.push(spawnPnpmWindowsSafe(["run", "dev:next"]));
  children.push(
    spawnPnpmWindowsSafe([
      "exec",
      "convex",
      "dev",
      "--typecheck=disable",
    ]),
  );
}

let shuttingDown = false;

const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch {
        // Child may already have exited.
      }
    }
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const child of children) {
  child.on("error", (error) => {
    if (!shuttingDown) {
      console.error(`Local process failed to start: ${error.message}`);
      shuttingDown = true;
      shutdown("SIGTERM");
      process.exit(1);
    }
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    console.error(
      `Local process exited (code=${code ?? "null"}, signal=${signal ?? "none"}).`,
    );
    shuttingDown = true;
    shutdown("SIGTERM");
    process.exit(code ?? 1);
  });
}
