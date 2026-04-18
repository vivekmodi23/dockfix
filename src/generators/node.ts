import fs from "fs";
import path from "path";

export function generateNodeFiles(target: any = ".") {
  const pkg = path.join(target, "package.json");

  const packageJson = JSON.parse(
    fs.readFileSync(pkg, "utf-8")
  );

  const scripts = packageJson.scripts || {};

  const hasBuild = !!scripts.build;
  const hasStart = !!scripts.start;

  let dockerfile = `FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
`;

  if (hasBuild) dockerfile += `RUN npm run build\n`;

  if (hasStart) {
    dockerfile += `CMD ["npm","start"]\n`;
  } else {
    dockerfile += `CMD ["node","index.js"]\n`;
  }

  const dockerignore = `node_modules
npm-debug.log
.git
.env
dist
.next
`;

  fs.writeFileSync(path.join(target, "Dockerfile"), dockerfile);
  fs.writeFileSync(path.join(target, ".dockerignore"), dockerignore);

  console.log(`Dockerfile created in ${target}`);
  console.log(`.dockerignore created in ${target}`);
}