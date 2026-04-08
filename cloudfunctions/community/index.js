"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// functions/community/index.ts
var index_exports = {};
__export(index_exports, {
  handleApprove: () => handleApprove,
  handleCreate: () => handleCreate,
  handleGet: () => handleGet,
  handleList: () => handleList,
  handleReject: () => handleReject,
  main: () => main
});
module.exports = __toCommonJS(index_exports);
var import_wx_server_sdk2 = __toESM(require("wx-server-sdk"));

// lib/db.ts
var import_wx_server_sdk = __toESM(require("wx-server-sdk"));
import_wx_server_sdk.default.init({ env: import_wx_server_sdk.default.DYNAMIC_CURRENT_ENV });
var db = import_wx_server_sdk.default.database();
var _ = db.command;
function collection(name) {
  return db.collection(name);
}
async function getById(collectionName, id) {
  const res = await collection(collectionName).doc(id).get();
  return res.data;
}
async function create(collectionName, data) {
  const res = await collection(collectionName).add({ data });
  return res._id;
}
async function updateById(collectionName, id, data) {
  return collection(collectionName).doc(id).update({ data });
}
async function query(collectionName, where, options = {}) {
  let q = collection(collectionName).where(where);
  if (options.orderBy) q = q.orderBy(options.orderBy[0], options.orderBy[1]);
  if (options.skip !== void 0) q = q.skip(options.skip);
  if (options.limit !== void 0) q = q.limit(options.limit);
  const res = await q.get();
  return res.data;
}

// lib/auth.ts
async function assertSuperAdmin(openId) {
  const user = await getById("users", openId);
  if (user.role !== "superAdmin") throw new Error("\u6743\u9650\u4E0D\u8DB3");
}

// functions/community/index.ts
import_wx_server_sdk2.default.init({ env: import_wx_server_sdk2.default.DYNAMIC_CURRENT_ENV });
async function handleCreate(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const communityId = await create("communities", {
    name: params.name,
    description: params.description,
    coverImage: params.coverImage,
    location: params.location,
    joinType: params.joinType,
    creatorId: OPENID,
    status: "pending",
    memberCount: 0,
    createdAt: now
  });
  await create("community_members", {
    communityId,
    userId: OPENID,
    role: "admin",
    status: "active",
    appliedAt: now,
    joinedAt: now
  });
  return { communityId };
}
async function handleApprove(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  await assertSuperAdmin(OPENID);
  await updateById("communities", params.communityId, { status: "active" });
  return { success: true };
}
async function handleReject(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  await assertSuperAdmin(OPENID);
  await updateById("communities", params.communityId, { status: "disabled" });
  return { success: true };
}
async function handleList(params) {
  if (params.includeAll) {
    const [active, pending] = await Promise.all([
      query("communities", { status: "active" }, { orderBy: ["createdAt", "desc"] }),
      query("communities", { status: "pending" }, { orderBy: ["createdAt", "desc"] })
    ]);
    return { communities: [...active, ...pending] };
  }
  const communities = await query("communities", { status: "active" }, {
    orderBy: ["createdAt", "desc"]
  });
  return { communities };
}
async function handleGet(params) {
  const community = await getById("communities", params.communityId);
  return { community };
}
var main = async (event) => {
  const { action, params = {} } = event;
  if (action === "create") return handleCreate(params);
  if (action === "approve") return handleApprove(params);
  if (action === "reject") return handleReject(params);
  if (action === "list") return handleList(params);
  if (action === "get") return handleGet(params);
  throw new Error(`Unknown action: ${action}`);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handleApprove,
  handleCreate,
  handleGet,
  handleList,
  handleReject,
  main
});
