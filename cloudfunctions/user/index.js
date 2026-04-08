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

// functions/user/index.ts
var index_exports = {};
__export(index_exports, {
  handleLogin: () => handleLogin,
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

// functions/user/index.ts
import_wx_server_sdk2.default.init({ env: import_wx_server_sdk2.default.DYNAMIC_CURRENT_ENV });
async function handleLogin(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID: must be called from WeChat miniprogram");
  let existingUser = null;
  try {
    existingUser = await getById("users", OPENID);
  } catch (err) {
    const isNotFound = (err == null ? void 0 : err.errCode) === -502001 || (err == null ? void 0 : err.message) && (err.message.includes("not found") || err.message.includes("does not exist"));
    if (!isNotFound) throw err;
  }
  if (existingUser) {
    await updateById("users", OPENID, {
      nickName: params.nickName,
      avatarUrl: params.avatarUrl
    });
    return {
      user: { ...existingUser, nickName: params.nickName, avatarUrl: params.avatarUrl },
      isNew: false
    };
  } else {
    const newUser = {
      _id: OPENID,
      nickName: params.nickName,
      avatarUrl: params.avatarUrl,
      role: "user",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await create("users", newUser);
    return { user: newUser, isNew: true };
  }
}
var main = async (event) => {
  const { action, ...params } = event;
  if (action === "login") return handleLogin(params);
  throw new Error(`Unknown action: ${action}`);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handleLogin,
  main
});
