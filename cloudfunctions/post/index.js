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

// functions/post/index.ts
var index_exports = {};
__export(index_exports, {
  handleCreate: () => handleCreate,
  handleDelete: () => handleDelete,
  handleGet: () => handleGet,
  handleList: () => handleList,
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
async function softDelete(collectionName, id) {
  return updateById(collectionName, id, { status: "deleted" });
}
async function query(collectionName, where, options = {}) {
  let q = collection(collectionName).where(where);
  if (options.orderBy) q = q.orderBy(options.orderBy[0], options.orderBy[1]);
  if (options.skip !== void 0) q = q.skip(options.skip);
  if (options.limit !== void 0) q = q.limit(options.limit);
  const res = await q.get();
  return res.data;
}

// functions/post/index.ts
import_wx_server_sdk2.default.init({ env: import_wx_server_sdk2.default.DYNAMIC_CURRENT_ENV });
async function handleCreate(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  const members = await query("community_members", {
    communityId: params.communityId,
    userId: OPENID,
    status: "active"
  });
  if (!members || members.length === 0) throw new Error("\u975E\u793E\u533A\u6210\u5458\uFF0C\u65E0\u6CD5\u53D1\u5E16");
  const section = await getById("sections", params.sectionId);
  for (const widget of section.widgets) {
    if (widget.required) {
      const value = params.content[widget.widgetId];
      const isEmpty = value === void 0 || value === null || value === "" || Array.isArray(value) && value.length === 0;
      if (isEmpty) {
        throw new Error(`\u5FC5\u586B\u9879\u672A\u586B\u5199\uFF1A${widget.label}`);
      }
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const postId = await create("posts", {
    communityId: params.communityId,
    sectionId: params.sectionId,
    authorId: OPENID,
    status: "active",
    content: params.content,
    commentCount: 0,
    likeCount: 0,
    createdAt: now,
    updatedAt: now
  });
  return { postId };
}
async function handleList(params) {
  const posts = await query("posts", {
    sectionId: params.sectionId,
    status: "active"
  }, {
    orderBy: ["createdAt", "desc"],
    skip: params.skip ?? 0,
    limit: params.limit ?? 20
  });
  return { posts };
}
async function handleGet(params) {
  const post = await getById("posts", params.postId);
  if (post.status === "deleted") throw new Error("\u5E16\u5B50\u4E0D\u5B58\u5728");
  return { post };
}
async function handleDelete(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  const post = await getById("posts", params.postId);
  if (post.status === "deleted") throw new Error("\u5E16\u5B50\u5DF2\u5220\u9664");
  if (post.authorId !== OPENID) throw new Error("\u65E0\u6743\u5220\u9664");
  await softDelete("posts", params.postId);
  return { success: true };
}
var main = async (event) => {
  const { action, params = {} } = event;
  if (action === "create") return handleCreate(params);
  if (action === "list") return handleList(params);
  if (action === "get") return handleGet(params);
  if (action === "delete") return handleDelete(params);
  throw new Error(`Unknown action: ${action}`);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handleCreate,
  handleDelete,
  handleGet,
  handleList,
  main
});
