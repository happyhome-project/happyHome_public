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

// functions/member/index.ts
var index_exports = {};
__export(index_exports, {
  handleApply: () => handleApply,
  handleLeave: () => handleLeave,
  handleMemberApprove: () => handleMemberApprove,
  handleMemberReject: () => handleMemberReject,
  handlePendingList: () => handlePendingList,
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
async function increment(collectionName, docId, field, delta) {
  return collection(collectionName).doc(docId).update({
    data: { [field]: _.inc(delta) }
  });
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
async function assertCommunityAdmin(openId, communityId) {
  const members = await query("community_members", {
    communityId,
    userId: openId,
    role: "admin",
    status: "active"
  });
  if (!members || members.length === 0) throw new Error("\u6743\u9650\u4E0D\u8DB3");
}

// functions/member/index.ts
import_wx_server_sdk2.default.init({ env: import_wx_server_sdk2.default.DYNAMIC_CURRENT_ENV });
async function handleApply(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  const existingActive = await query("community_members", {
    communityId: params.communityId,
    userId: OPENID,
    status: "active"
  });
  if (existingActive && existingActive.length > 0) throw new Error("\u5DF2\u662F\u793E\u533A\u6210\u5458");
  const existingPending = await query("community_members", {
    communityId: params.communityId,
    userId: OPENID,
    status: "pending"
  });
  if (existingPending && existingPending.length > 0) throw new Error("\u5DF2\u6709\u5F85\u5BA1\u6279\u7684\u7533\u8BF7");
  const community = await getById("communities", params.communityId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (community.joinType === "open") {
    await create("community_members", {
      communityId: params.communityId,
      userId: OPENID,
      role: "member",
      status: "active",
      appliedAt: now,
      joinedAt: now
    });
    await increment("communities", params.communityId, "memberCount", 1);
    return { status: "active" };
  } else {
    await create("community_members", {
      communityId: params.communityId,
      userId: OPENID,
      role: "member",
      status: "pending",
      appliedAt: now
    });
    return { status: "pending" };
  }
}
async function handleLeave(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  const members = await query("community_members", {
    communityId: params.communityId,
    userId: OPENID,
    status: "active"
  });
  if (!members || members.length === 0) throw new Error("\u4E0D\u662F\u793E\u533A\u6210\u5458");
  const memberId = members[0]._id;
  await updateById("community_members", memberId, {
    status: "left",
    leftAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  await increment("communities", params.communityId, "memberCount", -1);
  return { success: true };
}
async function handleMemberApprove(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  await assertCommunityAdmin(OPENID, params.communityId);
  await updateById("community_members", params.memberId, {
    status: "active",
    joinedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  await increment("communities", params.communityId, "memberCount", 1);
  return { success: true };
}
async function handleMemberReject(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  await assertCommunityAdmin(OPENID, params.communityId);
  await updateById("community_members", params.memberId, {
    status: "rejected",
    rejectedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return { success: true };
}
async function handlePendingList(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  await assertCommunityAdmin(OPENID, params.communityId);
  const members = await query("community_members", {
    communityId: params.communityId,
    status: "pending"
  });
  return { members };
}
var main = async (event) => {
  const { action, params = {} } = event;
  if (action === "apply") return handleApply(params);
  if (action === "leave") return handleLeave(params);
  if (action === "memberApprove") return handleMemberApprove(params);
  if (action === "memberReject") return handleMemberReject(params);
  if (action === "pendingList") return handlePendingList(params);
  throw new Error(`Unknown action: ${action}`);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handleApply,
  handleLeave,
  handleMemberApprove,
  handleMemberReject,
  handlePendingList,
  main
});
