#!/usr/bin/env node

import { Command } from "commander";
import { detectProject } from "./detect/project.js";
import { generateNodeFiles } from "./generators/node.js";

const program = new Command();

program
  .name("dockfix")
  .description("Generate Docker setup for projects")
  .version("0.1.0");

program
  .command("init [path]")
  .description("Scan current project")
  .action((path) => {
    console.log(`Scanning ${path}...`);

    const result = detectProject();

    console.log(`Detected: ${result}`);

    if (result === "Node.js project") {
      generateNodeFiles(path);
    } else {
      console.log("Generation not supported yet.");
    }
  });

program.parse();