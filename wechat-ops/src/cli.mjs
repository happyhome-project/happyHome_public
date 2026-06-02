#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "./config.mjs";
import { assertDateRange, compactDate } from "./date.mjs";
import { fetchAccessToken, getJsonWithAccessToken, postDatacube, postJsonWithAccessToken } from "./wechat-client.mjs";
import { getEndpoint, listEndpoints } from "./endpoints.mjs";

const KF_ENDPOINTS = {
  add: "/customservice/kfaccount/add",
  invite: "/customservice/kfaccount/inviteworker",
  list: "/cgi-bin/customservice/getkflist",
  online: "/cgi-bin/customservice/getonlinekflist"
};

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

  if (command === "kf:list") {
    await kfListCommand(args);
    return;
  }

  if (command === "kf:online") {
    await kfOnlineCommand(args);
    return;
  }

  if (command === "kf:add") {
    await kfAddCommand(args);
    return;
  }

  if (command === "kf:invite") {
    await kfInviteCommand(args);
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

async function kfListCommand(args) {
  const { options } = parseArgs(args);
  await kfReadCommand({
    path: KF_ENDPOINTS.list,
    businessId: options["business-id"],
    dryRun: Boolean(options["dry-run"])
  });
}

async function kfOnlineCommand(args) {
  const { options } = parseArgs(args);
  await kfReadCommand({
    path: KF_ENDPOINTS.online,
    businessId: options["business-id"],
    dryRun: Boolean(options["dry-run"])
  });
}

async function kfReadCommand({ path, businessId, dryRun }) {
  const query = businessId ? { business_id: businessId } : {};
  if (dryRun) {
    console.log(JSON.stringify({ method: "GET", path, query }, null, 2));
    return;
  }

  const accessToken = await resolveAccessToken();
  const data = await getJsonWithAccessToken({ path, query, accessToken });
  console.log(JSON.stringify(data, null, 2));
}

async function kfAddCommand(args) {
  const { options } = parseArgs(args);
  const kfAccount = String(options.account || "").trim();
  const nickname = String(options.nickname || "").trim();
  const businessId = String(options["business-id"] || "").trim();

  if (!kfAccount) {
    throw new Error("Missing --account. Example: --account feedback@your_account_suffix");
  }
  if (!nickname) {
    throw new Error("Missing --nickname. Example: --nickname HappyHome客服");
  }

  const body = {
    kf_account: kfAccount,
    nickname,
    ...(businessId ? { business_id: businessId } : {})
  };

  if (options["dry-run"]) {
    console.log(JSON.stringify({ method: "POST", path: KF_ENDPOINTS.add, body }, null, 2));
    return;
  }

  const accessToken = await resolveAccessToken();
  const data = await postJsonWithAccessToken({ path: KF_ENDPOINTS.add, body, accessToken });
  console.log(JSON.stringify(data, null, 2));
}

async function kfInviteCommand(args) {
  const { options } = parseArgs(args);
  const kfAccount = String(options.account || "").trim();
  const inviteWx = String(options["invite-wx"] || "").trim();

  if (!kfAccount) {
    throw new Error("Missing --account. Example: --account feedback@your_account_suffix");
  }
  if (!inviteWx) {
    throw new Error("Missing --invite-wx. Example: --invite-wx wx123456");
  }

  const body = {
    kf_account: kfAccount,
    invite_wx: inviteWx
  };

  if (options["dry-run"]) {
    console.log(JSON.stringify({ method: "POST", path: KF_ENDPOINTS.invite, body }, null, 2));
    return;
  }

  const accessToken = await resolveAccessToken();
  const data = await postJsonWithAccessToken({ path: KF_ENDPOINTS.invite, body, accessToken });
  console.log(JSON.stringify(data, null, 2));
}

async function resolveAccessToken() {
  const config = loadConfig();
  return config.accessToken || await fetchAccessToken(config);
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
  node src/cli.mjs fetch <endpoint> --begin YYYY-MM-DD --end YYYY-MM-DD [--out reports] [--dry-run]
  node src/cli.mjs kf:list [--business-id ID] [--dry-run]
  node src/cli.mjs kf:online [--business-id ID] [--dry-run]
  node src/cli.mjs kf:add --account ACCOUNT --nickname NAME [--business-id ID] [--dry-run]
  node src/cli.mjs kf:invite --account ACCOUNT --invite-wx WECHAT_ID [--dry-run]`);
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
