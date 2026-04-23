import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { setTimeout as delay } from "timers/promises";
import { DEFAULT_DOCKERIGNORE } from "../generators/docker.js";
import { gatherRepoContext } from "./repo-context.js";
import { chatCompletion, type ChatMessage } from "./llm.js";
import { dockerSafeTag } from "../util/image-tag.js";

function combineSpawnOut(r: ReturnType<typeof spawnSync>): string {
  return `${r.stderr || ""}${r.stdout || ""}`.trim();
}

export function extractDockerfile(raw: string): string {
  let t = raw.trim();
  const fence = t.match(/```(?:dockerfile)?\s*([\s\S]*?)```/i);
  if (fence) {
    t = fence[1].trim();
  }
  const lines = t.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^\s*FROM\s/i.test(l));
  if (idx < 0) {
    throw new Error("Model output did not contain a FROM instruction.");
  }
  return lines.slice(idx).join("\n").trim();
}

function dockerBuild(projectDir: string, imageTag: string): { ok: boolean; log: string } {
  const r = spawnSync("docker", ["build", "-t", imageTag, "."], {
    cwd: projectDir,
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return { ok: r.status === 0, log: combineSpawnOut(r) || "(no output)" };
}

async function httpOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function dockerSmokeTest(imageTag: string): Promise<{ ok: boolean; detail: string }> {
  const name = `dockfix-smoke-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const run = spawnSync("docker", ["run", "-d", "--name", name, "-P", imageTag], { encoding: "utf-8" });
  if (run.status !== 0) {
    return { ok: false, detail: `docker run failed:\n${combineSpawnOut(run)}` };
  }

  await delay(4000);
  const inspect0 = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf-8" });
  if ((inspect0.stdout || "").trim() !== "true") {
    const logs0 = spawnSync("docker", ["logs", "--tail", "200", name], { encoding: "utf-8" });
    spawnSync("docker", ["rm", "-f", name], { encoding: "utf-8" });
    return { ok: false, detail: `Container exited before smoke test.\n${combineSpawnOut(logs0)}` };
  }
  await delay(4000);

  const logs = spawnSync("docker", ["logs", "--tail", "200", name], { encoding: "utf-8" });
  const portOut = spawnSync("docker", ["port", name], { encoding: "utf-8" });
  const portText = portOut.stdout || "";
  const logText = combineSpawnOut(logs);
  const inspect = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf-8" });
  const isRunning = (inspect.stdout || "").trim() === "true";

  const hostPorts = [...portText.matchAll(/-> .+:(\d+)/g)].map((m) => Number(m[1]));

  const paths = ["/", "/index.html", "/health", "/api/health", "/api", "/ready"];

  const tryHttp = async () => {
    for (const hp of hostPorts) {
      for (const p of paths) {
        const url = `http://127.0.0.1:${hp}${p}`;
        if (await httpOk(url)) {
          return url;
        }
      }
    }
    return null;
  };

  let url = await tryHttp();
  if (!url) {
    await delay(5000);
    url = await tryHttp();
  }
  if (url) {
    spawnSync("docker", ["rm", "-f", name], { encoding: "utf-8" });
    return { ok: true, detail: `HTTP OK ${url}` };
  }

  // `serve` and some static tools log "Serving" before the server accepts connections.
  if (isRunning && /serving|listening|ready in/i.test(logText)) {
    spawnSync("docker", ["rm", "-f", name], { encoding: "utf-8" });
    return {
      ok: true,
      detail: `Treated as healthy: process logs indicate server is up. docker port:\n${portText || "(empty)"}\nlogs:\n${logText}`,
    };
  }

  // If service is not HTTP (worker/consumer) but container stays running, treat as successful run.
  if (isRunning) {
    spawnSync("docker", ["rm", "-f", name], { encoding: "utf-8" });
    return {
      ok: true,
      detail: `Container stayed running for smoke window (non-HTTP or unknown endpoint). docker port:\n${portText || "(empty)"}\nlogs:\n${combineSpawnOut(logs)}`,
    };
  }

  spawnSync("docker", ["rm", "-f", name], { encoding: "utf-8" });
  return {
    ok: false,
    detail: `No HTTP success on published ports. docker port:\n${portText || "(empty)"}\nlogs:\n${combineSpawnOut(logs)}`,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… (truncated, ${s.length} chars total)`;
}

const SYSTEM_PROMPT = `You are an expert at writing Dockerfiles for web app repositories (Node.js stacks and Streamlit Python apps).

Hard rules:
- Output ONLY the Dockerfile contents. No markdown fences, no explanations before or after.
- The first non-empty line MUST be FROM.
- You must NEVER modify application source code; only the Dockerfile is allowed to change between attempts.
- Prefer official images (node, nginx). Use WORKDIR /app unless the repo clearly needs another layout.
- Ensure the container listens on 0.0.0.0 for servers so published ports work.
- EXPOSE the port(s) the app listens on so smoke tests can map them with docker run -P.
- Production-oriented: avoid leaking devDependencies into the final runtime when practical (multi-stage is fine).
- Create React App (react-scripts): use multi-stage build, then in the final stage RUN npm install -g serve@14 and CMD ["serve","-s","build","-l","3000"]. Do not use npx serve with --host; do not pass http: URLs to serve (CLI differs by version).`;

export type AiDockerizeOpts = {
  projectDir: string;
  imageTag?: string;
  maxAttempts: number;
  allowFileFixes?: boolean;
};

export async function runAiDockerize(opts: AiDockerizeOpts): Promise<void> {
  const projectDir = path.resolve(opts.projectDir);
  const base = path.basename(projectDir);
  const imageTag = opts.imageTag || `dockfix-${dockerSafeTag(base)}`;

  if (!fs.existsSync(path.join(projectDir, "package.json"))) {
    console.error("dockerize-ai requires a directory with package.json.");
    process.exit(1);
  }

  const dockerignorePath = path.join(projectDir, ".dockerignore");
  if (!fs.existsSync(dockerignorePath)) {
    fs.writeFileSync(dockerignorePath, DEFAULT_DOCKERIGNORE);
    console.log("Wrote default .dockerignore (repo had none).");
  } else {
    console.log("Keeping existing .dockerignore; the agent only edits Dockerfile between attempts.");
  }

  const { text: contextText, detectResult } = gatherRepoContext(projectDir);
  console.log(`Context heuristic: ${detectResult}`);

  const stackHint =
    detectResult === "Create React App project"
      ? `
Stack hint (heuristic: react-scripts / CRA):
- Multi-stage: builder runs npm install && npm run build (set CI=true if needed for non-interactive builds).
- Final image: only copy build/ output, RUN npm install -g serve@14, CMD ["serve","-s","build","-l","3000"].
- Never use: npx serve --host, or --listen with an http: URL string; pin serve@14 for a stable CLI.
`
      : detectResult === "Streamlit project"
        ? `
Stack hint (heuristic: Streamlit):
- Use python:3.11-slim (or compatible python slim image).
- Install requirements from requirements.txt (or pyproject if clearly present).
- Run Streamlit with host/port flags:
  CMD ["streamlit","run","<entry>.py","--server.address=0.0.0.0","--server.port=8501"]
- EXPOSE 8501.
- Prefer app.py, streamlit_app.py, or main.py if present.
`
      : "";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Repository path on disk: ${projectDir}

${contextText}
${stackHint}
Write a single Dockerfile that builds and runs this project. Bind servers to 0.0.0.0 and EXPOSE the correct port(s).
${opts.allowFileFixes ? "Safe config-only edits are allowed by caller (no app source edits)." : ""}`,
    },
  ];

  let lastBuildLog = "";
  let lastSmokeDetail = "";

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    console.log(`\n── AI attempt ${attempt}/${opts.maxAttempts} ──`);

    let dockerfileBody: string;
    try {
      const raw = await chatCompletion(messages);
      dockerfileBody = extractDockerfile(raw);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }

    fs.writeFileSync(path.join(projectDir, "Dockerfile"), dockerfileBody);
    console.log(`Wrote Dockerfile (${dockerfileBody.split("\n").length} lines).`);

    const build = dockerBuild(projectDir, imageTag);
    lastBuildLog = build.log;
    if (!build.ok) {
      console.log("docker build failed.");
      messages.push({ role: "assistant", content: dockerfileBody });
      messages.push({
        role: "user",
        content: `docker build failed. Fix the Dockerfile only; output the full corrected Dockerfile.

Build output (truncated):
${truncate(build.log, 14000)}`,
      });
      continue;
    }

    console.log("docker build succeeded. Running smoke test (docker run -P + HTTP probe)…");
    const smoke = await dockerSmokeTest(imageTag);
    lastSmokeDetail = smoke.detail;
    if (!smoke.ok) {
      console.log("Smoke test failed.");
      messages.push({ role: "assistant", content: dockerfileBody });
      messages.push({
        role: "user",
        content: `docker build succeeded but the container did not respond with HTTP 2xx on common paths (/ /health /api/health /api /ready) on published ports.

${truncate(smoke.detail, 12000)}

Fix the Dockerfile only (CMD, EXPOSE, build steps, bind address, ports). Output the full corrected Dockerfile.`,
      });
      continue;
    }

    console.log(`\nOK — ${smoke.detail}`);
    console.log(`Image: ${imageTag}`);
    console.log(`Example: docker run --rm -it -P ${imageTag}`);
    return;
  }

  console.error("\nGiving up after max attempts. Last build log (truncated):");
  console.error(truncate(lastBuildLog, 8000));
  console.error("\nLast smoke detail (truncated):");
  console.error(truncate(lastSmokeDetail, 8000));
  process.exit(1);
}
