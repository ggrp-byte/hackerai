#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const isWindows = process.platform === "win32";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";
const convexEnvFile = join(root, ".hackerai.local-convex.env");

const selectArgs = [
  "exec",
  "convex",
  "deployment",
  "select",
  "local",
  "--env-file",
  convexEnvFile,
];
const createArgs = [
  "exec",
  "convex",
  "deployment",
  "create",
  "local",
  "--select",
  "--env-file",
  convexEnvFile,
];

const runPnpm = (args) =>
  spawnSync(pnpmCommand, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
    shell: isWindows,
    env: {
      ...process.env,
      CONVEX_DEPLOYMENT: undefined,
      NEXT_PUBLIC_CONVEX_URL: undefined,
      CONVEX_URL: undefined,
    },
  });

const replayOutput = (result) => {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
};

const exitForResult = (result, action) => {
  if (result.error) {
    console.error(
      `[convex-local] failed to ${action}: ${result.error.message}`,
    );
    process.exit(1);
  }
  process.exit(result.status ?? 1);
};

try {
  if (!existsSync(convexEnvFile)) {
    writeFileSync(convexEnvFile, "", "utf8");
  }

  const selection = runPnpm(selectArgs);

  if (selection.status === 0) {
    replayOutput(selection);
    process.exit(0);
  }

  const selectionOutput = `${selection.stdout ?? ""}\n${selection.stderr ?? ""}`;

  if (!selectionOutput.includes("No local deployment found.")) {
    replayOutput(selection);
    exitForResult(selection, "select the local deployment");
  }

  console.log(
    "[convex-local] No local deployment found; creating one for this worktree.",
  );

  const creation = runPnpm(createArgs);
  replayOutput(creation);
  exitForResult(creation, "create the local deployment");
} finally {
  try {
    unlinkSync(convexEnvFile);
  } catch {
    // Nothing to clean up if the temporary file was already removed.
  }
}
