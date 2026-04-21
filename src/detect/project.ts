import fs from "fs";
import path from "path";

export function detectProject(target: string = ".") {
  const pkgPath = path.join(target, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return "Not a Node.js project";
  }

  const packageJson = JSON.parse(
    fs.readFileSync(pkgPath, "utf-8")
  );

  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {})
  };

  if (deps.next) return "Next.js project";
  if (deps.express) return "Express project";
  if (deps["@nestjs/core"]) return "NestJS project";
  if (deps.vite) return "Vite project";
  if (deps.fastify) return "Fastify project";

  return "Node.js project";
}