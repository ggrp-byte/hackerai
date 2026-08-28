#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const root = process.cwd();
const isWindows = process.platform === "win32";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";

const result = spawnSync(
  pnpmCommand,
  ["exec", "convex", "dev", "--once"],
  {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: false,
    shell: isWindows,
    env: {
      ...process.env,
      CONVEX_DEPLOYMENT: undefined,
      NEXT_PUBLIC_CONVEX_URL: undefined,
      CONVEX_URL: undefined,
    },
  },
);

if (result.error) {
  console.error(
    `[convex-local] failed to initialize the local deployment: ${result.error.message}`,
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
