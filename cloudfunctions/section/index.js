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

// functions/section/index.ts
var index_exports = {};
__export(index_exports, {
  handleCreate: () => handleCreate,
  handleGet: () => handleGet,
  handleList: () => handleList,
  handleUpdate: () => handleUpdate,
  handleUpdateWidgets: () => handleUpdateWidgets,
  main: () => main
});
module.exports = __toCommonJS(index_exports);
var import_wx_server_sdk2 = __toESM(require("wx-server-sdk"));

// node_modules/uuid/dist-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

// node_modules/uuid/dist-node/rng.js
var import_node_crypto = require("node:crypto");
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    (0, import_node_crypto.randomFillSync)(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// node_modules/uuid/dist-node/native.js
var import_node_crypto2 = require("node:crypto");
var native_default = { randomUUID: import_node_crypto2.randomUUID };

// node_modules/uuid/dist-node/v4.js
function _v4(options, buf, offset) {
  var _a;
  options = options || {};
  const rnds = options.random ?? ((_a = options.rng) == null ? void 0 : _a.call(options)) ?? rng();
  if (rnds.length < 16) {
    throw new Error("Random bytes length must be >= 16");
  }
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    if (offset < 0 || offset + 16 > buf.length) {
      throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`);
    }
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  return _v4(options, buf, offset);
}
var v4_default = v4;

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
async function assertCommunityAdmin(openId, communityId) {
  const members = await query("community_members", {
    communityId,
    userId: openId,
    role: "admin",
    status: "active"
  });
  if (!members || members.length === 0) throw new Error("\u6743\u9650\u4E0D\u8DB3");
}

// shared/types.ts
var LIST_DISPLAYABLE_TYPES = [
  "short_text",
  "summary",
  "datetime",
  "number"
];

// functions/section/index.ts
import_wx_server_sdk2.default.init({ env: import_wx_server_sdk2.default.DYNAMIC_CURRENT_ENV });
async function handleCreate(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  await assertCommunityAdmin(OPENID, params.communityId);
  const sectionId = await create("sections", {
    communityId: params.communityId,
    name: params.name,
    icon: params.icon,
    order: params.order,
    enableComment: params.enableComment ?? true,
    enableLike: params.enableLike ?? true,
    widgets: [],
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return { sectionId };
}
async function handleGet(params) {
  const section = await getById("sections", params.sectionId);
  return { section };
}
async function handleList(params) {
  const sections = await query("sections", { communityId: params.communityId }, {
    orderBy: ["order", "asc"]
  });
  return { sections };
}
async function handleUpdateWidgets(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  await assertCommunityAdmin(OPENID, params.communityId);
  const widgets = params.widgets;
  const showInListCount = widgets.filter((w) => w.showInList).length;
  if (showInListCount > 3) throw new Error("showInList \u6700\u591A\u53EA\u80FD\u6709 3 \u4E2A\u63A7\u4EF6");
  for (const widget of widgets) {
    if (widget.showInList && !LIST_DISPLAYABLE_TYPES.includes(widget.type)) {
      throw new Error(`\u63A7\u4EF6\u7C7B\u578B ${widget.type} \u4E0D\u652F\u6301\u5728\u5217\u8868\u5C55\u793A`);
    }
  }
  const updatedWidgets = widgets.map((w) => ({
    ...w,
    widgetId: w.widgetId ? w.widgetId : v4_default()
  }));
  await updateById("sections", params.sectionId, { widgets: updatedWidgets });
  return { widgets: updatedWidgets };
}
async function handleUpdate(params) {
  const { OPENID } = import_wx_server_sdk2.default.getWXContext();
  if (!OPENID) throw new Error("Missing OPENID");
  await assertCommunityAdmin(OPENID, params.communityId);
  const { sectionId, communityId, ...updates } = params;
  await updateById("sections", sectionId, updates);
  return { success: true };
}
var main = async (event) => {
  const { action, params = {} } = event;
  if (action === "create") return handleCreate(params);
  if (action === "get") return handleGet(params);
  if (action === "list") return handleList(params);
  if (action === "updateWidgets") return handleUpdateWidgets(params);
  if (action === "update") return handleUpdate(params);
  throw new Error(`Unknown action: ${action}`);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handleCreate,
  handleGet,
  handleList,
  handleUpdate,
  handleUpdateWidgets,
  main
});
