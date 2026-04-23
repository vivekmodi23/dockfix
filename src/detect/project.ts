import fs from "fs";
import path from "path";

function hasStreamlitDependency(target: string): boolean {
  const requirementsPath = path.join(target, "requirements.txt");
  if (fs.existsSync(requirementsPath)) {
    const req = fs.readFileSync(requirementsPath, "utf-8");
    if (/^\s*streamlit([<>=!~].*)?\s*$/im.test(req)) return true;
  }

  const pyprojectPath = path.join(target, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    const pyproject = fs.readFileSync(pyprojectPath, "utf-8");
    if (/\bstreamlit\b/i.test(pyproject)) return true;
  }

  return false;
}

export function detectProject(target: string = ".") {
  const pkgPath = path.join(target, "package.json");
  if (fs.existsSync(pkgPath)) {
    const packageJson = JSON.parse(
      fs.readFileSync(pkgPath, "utf-8")
    );

    const deps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {})
    };

    if (deps.next) return "Next.js project";
    if (deps["react-scripts"]) return "Create React App project";
    if (deps.express) return "Express project";
    if (deps["@nestjs/core"]) return "NestJS project";
    if (deps.vite) return "Vite project";
    if (deps.fastify) return "Fastify project";

    return "Node.js project";
  }

  if (hasStreamlitDependency(target)) {
    return "Streamlit project";
  }

  return "Unsupported project";
}