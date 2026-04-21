import fs from "fs";
import path from "path";

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export const DEFAULT_DOCKERIGNORE = `node_modules
npm-debug.log
.git
.env
.env.*
dist
.next
build
coverage
.DS_Store
`;

function readPackageJson(target: string): PackageJson {
  const pkgPath = path.join(target, "package.json");
  return JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as PackageJson;
}

function writeArtifacts(target: string, dockerfile: string, dockerignore: string) {
  fs.writeFileSync(path.join(target, "Dockerfile"), dockerfile);
  fs.writeFileSync(path.join(target, ".dockerignore"), dockerignore);
  console.log(`Dockerfile created in ${target}`);
  console.log(`.dockerignore created in ${target}`);
}

/** Prefer exec-form CMD when start is a plain `node …` command (typical Fastify/Express). */
function cmdFromScripts(scripts: Record<string, string>): string[] {
  const start = scripts.start?.trim();
  if (start && /^node(\s|$)/i.test(start)) {
    return start.split(/\s+/).filter(Boolean);
  }
  if (scripts.start) return ["npm", "start"];
  return ["node", "index.js"];
}

function formatCmd(args: string[]) {
  return `CMD [${args.map((a) => JSON.stringify(a)).join(", ")}]\n`;
}

type NodeRuntimeKind = "node" | "express" | "fastify";

/** Express, Fastify, or generic Node — same layers, different banner / env defaults */
function nodeRuntimeDocker(target: string, kind: NodeRuntimeKind) {
  const packageJson = readPackageJson(target);
  const scripts = packageJson.scripts || {};
  const hasBuild = !!scripts.build;

  const banner =
    kind === "fastify"
      ? `# Fastify — https://fastify.dev/
# Fastify is an npm package on Node.js: the image starts from Node, then npm install adds fastify from package.json.`
      : kind === "express"
        ? `# Express — https://expressjs.com/
# Express is an npm package on Node.js: the image starts from Node, then npm install adds express from package.json.`
        : "# Node.js";

  const prodEnv =
    kind === "fastify" || kind === "express"
      ? `ENV NODE_ENV=production
`
      : "";

  let dockerfile = `${banner}
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

${prodEnv}EXPOSE 3000
`;

  if (hasBuild) dockerfile += `RUN npm run build\n`;

  dockerfile += "\n";
  dockerfile += formatCmd(cmdFromScripts(scripts));

  writeArtifacts(target, dockerfile, DEFAULT_DOCKERIGNORE);
}

function nextDocker(target: string) {
  const dockerfile = `FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Optional build-time auth/env args (pass real values with --build-arg when needed)
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG CLERK_SECRET_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV CLERK_SECRET_KEY=$CLERK_SECRET_KEY
ENV NODE_ENV=production
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
`;

  writeArtifacts(target, dockerfile, DEFAULT_DOCKERIGNORE);
}

function nestDocker(target: string) {
  const dockerfile = `FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/main.js"]
`;

  writeArtifacts(target, dockerfile, DEFAULT_DOCKERIGNORE);
}

function viteStaticDocker(target: string) {
  const dockerfile = `FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
`;

  writeArtifacts(target, dockerfile, DEFAULT_DOCKERIGNORE);
}

export function generateDockerFiles(target: string, projectType: string) {
  if (projectType === "Not a Node.js project") {
    console.log("No package.json found; skipping Docker generation.");
    return;
  }

  switch (projectType) {
    case "Next.js project":
      nextDocker(target);
      break;
    case "NestJS project":
      nestDocker(target);
      break;
    case "Vite project":
      viteStaticDocker(target);
      break;
    case "Express project":
      nodeRuntimeDocker(target, "express");
      break;
    case "Fastify project":
      nodeRuntimeDocker(target, "fastify");
      break;
    case "Node.js project":
      nodeRuntimeDocker(target, "node");
      break;
    default:
      console.log(`Unknown project type "${projectType}"; skipping Docker generation.`);
  }
}
