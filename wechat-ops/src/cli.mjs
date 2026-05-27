#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "./config.mjs";
import { assertDateRange, compactDate } from "./date.mjs";
import { fetchAccessToken, postDatacube } from "./wechat-client.mjs";
import { getEndpoint, listEndpoints } from "./endpoints.mjs";

async function main(argv) {
  const [command, ...args] = argv;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "list") {
    for (const endpoint of listEndpoints()) {
      console.log(`${endpoint.name}\t${endpoint.path}\t${endpoint.description}`);
    }
    return;
  }

  if (command === "fetch") {
    await fetchCommand(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function fetchCommand(args) {
  const { positionals, options } = parseArgs(args);
  const endpointName = positionals[0];
  const endpoint = getEndpoint(endpointName);
  if (!endpoint) {
    throw new Error(`Unknown endpoint: ${endpointName || "(missing)"}`);
  }

  const dateRange = assertDateRange(options.begin, options.end);
  const config = loadConfig();

  if (options["dry-run"]) {
    console.log(JSON.stringify({
      endpoint: endpointName,
      path: endpoint.path,
      body: dateRange,
      outputDir: options.out ? resolve(options.out) : config.outputDir
    }, null, 2));
    return;
  }

  const accessToken = config.accessToken || await fetchAccessToken(config);
  const data = await postDatacube({ endpoint, dateRange, accessToken });
  const outputDir = options.out ? resolve(options.out) : config.outputDir;
  await mkdir(outputDir, { recursive: true });

  const fileName = `${endpointName}.${compactDate(dateRange.begin_date)}-${compactDate(dateRange.end_date)}.json`;
  const outputPath = resolve(outputDir, fileName);
  await writeFile(outputPath, JSON.stringify({
    endpoint: endpointName,
    path: endpoint.path,
    request: dateRange,
    fetched_at: new Date().toISOString(),
    data
  }, null, 2));

  console.log(outputPath);
}

function parseArgs(args) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { positionals, options };
}

function printHelp() {
  console.log(`Usage:
  node src/cli.mjs list
  node src/cli.mjs fetch <endpoint> --begin YYYY-MM-DD --end YYYY-MM-DD [--out reports] [--dry-run]`);
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
