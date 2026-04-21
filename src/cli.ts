#!/usr/bin/env node

import os from "os";
import path from "path";
import { Command } from "commander";
import { runAiDockerize } from "./agent/dockerize-ai.js";
import { runCloneWorkflow } from "./commands/clone.js";
import { detectProject } from "./detect/project.js";
import { generateDockerFiles } from "./generators/docker.js";
import { loadDotEnv } from "./util/dotenv.js";

const program = new Command();
loadDotEnv(process.cwd());

program
  .name("dockfix")
  .description("Generate Docker setup for projects")
  .version("0.1.0");

program
  .command("init [path]")
  .description("Scan current project")
  .action((targetPath?: string) => {
    const target = path.resolve(targetPath ?? ".");

    console.log(`Scanning ${target}...`);

    const result = detectProject(target);

    console.log(`Detected: ${result}`);

    generateDockerFiles(target, result);
  });

const cloneCmd = program
  .command("clone <repository> [folder]")
  .description(
    "Clone repo into ~/Desktop/<folder> (by default), generate Dockerfile, docker build, then docker run"
  )
  .option(
    "-p, --parent <dir>",
    "Directory that will contain the clone (default: ~/Desktop)",
    path.join(os.homedir(), "Desktop")
  )
  .option("--full-history", "Full git clone instead of shallow (--depth 1)")
  .option("--skip-build", "Clone and add Dockerfile only (no docker build)")
  .option("--skip-run", "Build image but do not run the container")
  .option(
    "--allow-file-fixes",
    "Allow safe config-only edits on failure (.env.local, next config/package scripts), but never app source files"
  )
  .option(
    "--ai",
    "After clone: use an LLM (OPENAI_API_KEY) to write only Dockerfile, retry on docker build/smoke failure"
  )
  .option("--max-attempts <n>", "With --ai: max iterations (default: 6)", "6");

cloneCmd.action(async (repository: string, folder?: string) => {
  const o = cloneCmd.opts() as {
    parent: string;
    fullHistory?: boolean;
    skipBuild?: boolean;
    skipRun?: boolean;
    allowFileFixes?: boolean;
    ai?: boolean;
    maxAttempts?: string;
  };

  if (o.ai && (o.skipBuild || o.skipRun)) {
    console.error("--ai runs docker build and smoke tests; do not combine with --skip-build or --skip-run.");
    process.exit(1);
  }

  const maxAttempts = Math.max(1, parseInt(String(o.maxAttempts ?? "6"), 10) || 6);

  await runCloneWorkflow(repository, folder, {
    parent: path.resolve(o.parent),
    fullHistory: Boolean(o.fullHistory),
    skipBuild: Boolean(o.skipBuild),
    skipRun: Boolean(o.skipRun),
    allowFileFixes: Boolean(o.allowFileFixes),
    useAi: Boolean(o.ai),
    aiMaxAttempts: maxAttempts,
  });
});

const dockerizeAiCmd = program
  .command("dockerize-ai [path]")
  .description(
    "Use an LLM to write only a Dockerfile for an existing repo; iterate on docker build + HTTP smoke until OK (requires OPENAI_API_KEY)"
  )
  .option("-t, --tag <name>", "Docker image tag (default: dockfix-<folder>)")
  .option(
    "--allow-file-fixes",
    "Allow safe config-only edits on failure (.env.local, next config/package scripts), but never app source files"
  )
  .option("--max-attempts <n>", "Max AI iterations (default: 6)", "6");

dockerizeAiCmd.action(async (targetPath?: string) => {
  const o = dockerizeAiCmd.opts() as {
    tag?: string;
    maxAttempts?: string;
    allowFileFixes?: boolean;
  };
  const dir = path.resolve(targetPath ?? ".");
  const maxAttempts = Math.max(1, parseInt(String(o.maxAttempts ?? "6"), 10) || 6);
  await runAiDockerize({
    projectDir: dir,
    imageTag: o.tag?.trim() || undefined,
    maxAttempts,
    allowFileFixes: Boolean(o.allowFileFixes),
  });
});

program.parse();