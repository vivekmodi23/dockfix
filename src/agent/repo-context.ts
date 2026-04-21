import fs from "fs";
import path from "path";
import fg from "fast-glob";
import { detectProject } from "../detect/project.js";

const MAX_README = 6000;
const MAX_ENV_EXAMPLE = 2500;

export function gatherRepoContext(projectDir: string): { text: string; detectResult: string } {
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { text: "No package.json in this directory.", detectResult: "Not a Node.js project" };
  }

  const pkg = fs.readFileSync(pkgPath, "utf-8");
  const detectResult = detectProject(projectDir);

  const top = fg.sync("*", {
    cwd: projectDir,
    onlyFiles: false,
    deep: 1,
    markDirectories: true,
    ignore: ["node_modules", ".git"],
  });

  let readme = "";
  for (const name of ["README.md", "readme.md", "Readme.md"]) {
    const p = path.join(projectDir, name);
    if (fs.existsSync(p)) {
      readme = fs.readFileSync(p, "utf-8").slice(0, MAX_README);
      break;
    }
  }

  let envBlock = "";
  for (const name of [".env.example", ".env.sample"]) {
    const p = path.join(projectDir, name);
    if (fs.existsSync(p)) {
      envBlock = `File ${name} (truncated):\n${fs.readFileSync(p, "utf-8").slice(0, MAX_ENV_EXAMPLE)}`;
      break;
    }
  }

  const text = [
    `Heuristic project type (from package.json deps): ${detectResult}`,
    "",
    "Top-level entries (files and directories):",
    top.sort().join("\n"),
    "",
    "package.json:",
    pkg,
    envBlock ? `\n${envBlock}` : "",
    readme ? `\nREADME excerpt:\n${readme}` : "",
  ].join("\n");

  return { text, detectResult };
}
