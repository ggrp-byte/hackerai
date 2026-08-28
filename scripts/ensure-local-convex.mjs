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

const fail = (result, action) => {
  if (result.error) {
    console.error(
      `[convex-local] failed to ${action}: ${result.error.message}`,
    );
  }
  replayOutput(result);
  return result.status ?? 1;
};

let exitCode = 1;

try {
  if (!existsSync(convexEnvFile)) {
    writeFileSync(convexEnvFile, "", "utf8");
  }

  const selection = runPnpm(selectArgs);

  if (selection.status === 0) {
    replayOutput(selection);
    exitCode = 0;
  } else {
    const selectionOutput = `${selection.stdout ?? ""}\n${selection.stderr ?? ""}`;

    if (!selectionOutput.includes("No local deployment found.")) {
      exitCode = fail(selection, "select the local deployment");
    } else {
      console.log(
        "[convex-local] No local deployment found; creating one for this worktree.",
      );
      const creation = runPnpm(createArgs);
      exitCode = creation.status === 0
        ? (replayOutput(creation), 0)
        : fail(creation, "create the local deployment");
    }
  }
} finally {
  try {
    unlinkSync(convexEnvFile);
  } catch {
    // Temporary file may not exist.
  }
}

process.exit(exitCode);
