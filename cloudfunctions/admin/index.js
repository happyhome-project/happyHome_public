"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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

// node_modules/uuid/dist-node/max.js
var max_default;
var init_max = __esm({
  "node_modules/uuid/dist-node/max.js"() {
    max_default = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  }
});

// node_modules/uuid/dist-node/nil.js
var nil_default;
var init_nil = __esm({
  "node_modules/uuid/dist-node/nil.js"() {
    nil_default = "00000000-0000-0000-0000-000000000000";
  }
});

// node_modules/uuid/dist-node/regex.js
var regex_default;
var init_regex = __esm({
  "node_modules/uuid/dist-node/regex.js"() {
    regex_default = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
  }
});

// node_modules/uuid/dist-node/validate.js
function validate(uuid) {
  return typeof uuid === "string" && regex_default.test(uuid);
}
var validate_default;
var init_validate = __esm({
  "node_modules/uuid/dist-node/validate.js"() {
    init_regex();
    validate_default = validate;
  }
});

// node_modules/uuid/dist-node/parse.js
function parse(uuid) {
  if (!validate_default(uuid)) {
    throw TypeError("Invalid UUID");
  }
  let v;
  return Uint8Array.of((v = parseInt(uuid.slice(0, 8), 16)) >>> 24, v >>> 16 & 255, v >>> 8 & 255, v & 255, (v = parseInt(uuid.slice(9, 13), 16)) >>> 8, v & 255, (v = parseInt(uuid.slice(14, 18), 16)) >>> 8, v & 255, (v = parseInt(uuid.slice(19, 23), 16)) >>> 8, v & 255, (v = parseInt(uuid.slice(24, 36), 16)) / 1099511627776 & 255, v / 4294967296 & 255, v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255);
}
var parse_default;
var init_parse = __esm({
  "node_modules/uuid/dist-node/parse.js"() {
    init_validate();
    parse_default = parse;
  }
});

// node_modules/uuid/dist-node/stringify.js
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}
function stringify(arr, offset = 0) {
  const uuid = unsafeStringify(arr, offset);
  if (!validate_default(uuid)) {
    throw TypeError("Stringified UUID is invalid");
  }
  return uuid;
}
var byteToHex, stringify_default;
var init_stringify = __esm({
  "node_modules/uuid/dist-node/stringify.js"() {
    init_validate();
    byteToHex = [];
    for (let i = 0; i < 256; ++i) {
      byteToHex.push((i + 256).toString(16).slice(1));
    }
    stringify_default = stringify;
  }
});

// node_modules/uuid/dist-node/rng.js
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    (0, import_node_crypto.randomFillSync)(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}
var import_node_crypto, rnds8Pool, poolPtr;
var init_rng = __esm({
  "node_modules/uuid/dist-node/rng.js"() {
    import_node_crypto = require("node:crypto");
    rnds8Pool = new Uint8Array(256);
    poolPtr = rnds8Pool.length;
  }
});

// node_modules/uuid/dist-node/v1.js
function v1(options, buf, offset) {
  var _a;
  let bytes;
  const isV6 = (options == null ? void 0 : options._v6) ?? false;
  if (options) {
    const optionsKeys = Object.keys(options);
    if (optionsKeys.length === 1 && optionsKeys[0] === "_v6") {
      options = void 0;
    }
  }
  if (options) {
    bytes = v1Bytes(options.random ?? ((_a = options.rng) == null ? void 0 : _a.call(options)) ?? rng(), options.msecs, options.nsecs, options.clockseq, options.node, buf, offset);
  } else {
    const now = Date.now();
    const rnds = rng();
    updateV1State(_state, now, rnds);
    bytes = v1Bytes(rnds, _state.msecs, _state.nsecs, isV6 ? void 0 : _state.clockseq, isV6 ? void 0 : _state.node, buf, offset);
  }
  return buf ?? unsafeStringify(bytes);
}
function updateV1State(state, now, rnds) {
  state.msecs ??= -Infinity;
  state.nsecs ??= 0;
  if (now === state.msecs) {
    state.nsecs++;
    if (state.nsecs >= 1e4) {
      state.node = void 0;
      state.nsecs = 0;
    }
  } else if (now > state.msecs) {
    state.nsecs = 0;
  } else if (now < state.msecs) {
    state.node = void 0;
  }
  if (!state.node) {
    state.node = rnds.slice(10, 16);
    state.node[0] |= 1;
    state.clockseq = (rnds[8] << 8 | rnds[9]) & 16383;
  }
  state.msecs = now;
  return state;
}
function v1Bytes(rnds, msecs, nsecs, clockseq, node, buf, offset = 0) {
  if (rnds.length < 16) {
    throw new Error("Random bytes length must be >= 16");
  }
  if (!buf) {
    buf = new Uint8Array(16);
    offset = 0;
  } else {
    if (offset < 0 || offset + 16 > buf.length) {
      throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`);
    }
  }
  msecs ??= Date.now();
  nsecs ??= 0;
  clockseq ??= (rnds[8] << 8 | rnds[9]) & 16383;
  node ??= rnds.slice(10, 16);
  msecs += 122192928e5;
  const tl = ((msecs & 268435455) * 1e4 + nsecs) % 4294967296;
  buf[offset++] = tl >>> 24 & 255;
  buf[offset++] = tl >>> 16 & 255;
  buf[offset++] = tl >>> 8 & 255;
  buf[offset++] = tl & 255;
  const tmh = msecs / 4294967296 * 1e4 & 268435455;
  buf[offset++] = tmh >>> 8 & 255;
  buf[offset++] = tmh & 255;
  buf[offset++] = tmh >>> 24 & 15 | 16;
  buf[offset++] = tmh >>> 16 & 255;
  buf[offset++] = clockseq >>> 8 | 128;
  buf[offset++] = clockseq & 255;
  for (let n = 0; n < 6; ++n) {
    buf[offset++] = node[n];
  }
  return buf;
}
var _state, v1_default;
var init_v1 = __esm({
  "node_modules/uuid/dist-node/v1.js"() {
    init_rng();
    init_stringify();
    _state = {};
    v1_default = v1;
  }
});

// node_modules/uuid/dist-node/v1ToV6.js
function v1ToV6(uuid) {
  const v1Bytes2 = typeof uuid === "string" ? parse_default(uuid) : uuid;
  const v6Bytes = _v1ToV6(v1Bytes2);
  return typeof uuid === "string" ? unsafeStringify(v6Bytes) : v6Bytes;
}
function _v1ToV6(v1Bytes2) {
  return Uint8Array.of((v1Bytes2[6] & 15) << 4 | v1Bytes2[7] >> 4 & 15, (v1Bytes2[7] & 15) << 4 | (v1Bytes2[4] & 240) >> 4, (v1Bytes2[4] & 15) << 4 | (v1Bytes2[5] & 240) >> 4, (v1Bytes2[5] & 15) << 4 | (v1Bytes2[0] & 240) >> 4, (v1Bytes2[0] & 15) << 4 | (v1Bytes2[1] & 240) >> 4, (v1Bytes2[1] & 15) << 4 | (v1Bytes2[2] & 240) >> 4, 96 | v1Bytes2[2] & 15, v1Bytes2[3], v1Bytes2[8], v1Bytes2[9], v1Bytes2[10], v1Bytes2[11], v1Bytes2[12], v1Bytes2[13], v1Bytes2[14], v1Bytes2[15]);
}
var init_v1ToV6 = __esm({
  "node_modules/uuid/dist-node/v1ToV6.js"() {
    init_parse();
    init_stringify();
  }
});

// node_modules/uuid/dist-node/md5.js
function md5(bytes) {
  if (Array.isArray(bytes)) {
    bytes = Buffer.from(bytes);
  } else if (typeof bytes === "string") {
    bytes = Buffer.from(bytes, "utf8");
  }
  return (0, import_node_crypto2.createHash)("md5").update(bytes).digest();
}
var import_node_crypto2, md5_default;
var init_md5 = __esm({
  "node_modules/uuid/dist-node/md5.js"() {
    import_node_crypto2 = require("node:crypto");
    md5_default = md5;
  }
});

// node_modules/uuid/dist-node/v35.js
function stringToBytes(str) {
  str = unescape(encodeURIComponent(str));
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; ++i) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}
function v35(version2, hash, value, namespace, buf, offset) {
  const valueBytes = typeof value === "string" ? stringToBytes(value) : value;
  const namespaceBytes = typeof namespace === "string" ? parse_default(namespace) : namespace;
  if (typeof namespace === "string") {
    namespace = parse_default(namespace);
  }
  if ((namespace == null ? void 0 : namespace.length) !== 16) {
    throw TypeError("Namespace must be array-like (16 iterable integer values, 0-255)");
  }
  let bytes = new Uint8Array(16 + valueBytes.length);
  bytes.set(namespaceBytes);
  bytes.set(valueBytes, namespaceBytes.length);
  bytes = hash(bytes);
  bytes[6] = bytes[6] & 15 | version2;
  bytes[8] = bytes[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = bytes[i];
    }
    return buf;
  }
  return unsafeStringify(bytes);
}
var DNS, URL;
var init_v35 = __esm({
  "node_modules/uuid/dist-node/v35.js"() {
    init_parse();
    init_stringify();
    DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
  }
});

// node_modules/uuid/dist-node/v3.js
function v3(value, namespace, buf, offset) {
  return v35(48, md5_default, value, namespace, buf, offset);
}
var v3_default;
var init_v3 = __esm({
  "node_modules/uuid/dist-node/v3.js"() {
    init_md5();
    init_v35();
    v3.DNS = DNS;
    v3.URL = URL;
    v3_default = v3;
  }
});

// node_modules/uuid/dist-node/native.js
var import_node_crypto3, native_default;
var init_native = __esm({
  "node_modules/uuid/dist-node/native.js"() {
    import_node_crypto3 = require("node:crypto");
    native_default = { randomUUID: import_node_crypto3.randomUUID };
  }
});

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
var v4_default;
var init_v4 = __esm({
  "node_modules/uuid/dist-node/v4.js"() {
    init_native();
    init_rng();
    init_stringify();
    v4_default = v4;
  }
});

// node_modules/uuid/dist-node/sha1.js
function sha1(bytes) {
  if (Array.isArray(bytes)) {
    bytes = Buffer.from(bytes);
  } else if (typeof bytes === "string") {
    bytes = Buffer.from(bytes, "utf8");
  }
  return (0, import_node_crypto4.createHash)("sha1").update(bytes).digest();
}
var import_node_crypto4, sha1_default;
var init_sha1 = __esm({
  "node_modules/uuid/dist-node/sha1.js"() {
    import_node_crypto4 = require("node:crypto");
    sha1_default = sha1;
  }
});

// node_modules/uuid/dist-node/v5.js
function v5(value, namespace, buf, offset) {
  return v35(80, sha1_default, value, namespace, buf, offset);
}
var v5_default;
var init_v5 = __esm({
  "node_modules/uuid/dist-node/v5.js"() {
    init_sha1();
    init_v35();
    v5.DNS = DNS;
    v5.URL = URL;
    v5_default = v5;
  }
});

// node_modules/uuid/dist-node/v6.js
function v6(options, buf, offset) {
  options ??= {};
  offset ??= 0;
  let bytes = v1_default({ ...options, _v6: true }, new Uint8Array(16));
  bytes = v1ToV6(bytes);
  if (buf) {
    for (let i = 0; i < 16; i++) {
      buf[offset + i] = bytes[i];
    }
    return buf;
  }
  return unsafeStringify(bytes);
}
var v6_default;
var init_v6 = __esm({
  "node_modules/uuid/dist-node/v6.js"() {
    init_stringify();
    init_v1();
    init_v1ToV6();
    v6_default = v6;
  }
});

// node_modules/uuid/dist-node/v6ToV1.js
function v6ToV1(uuid) {
  const v6Bytes = typeof uuid === "string" ? parse_default(uuid) : uuid;
  const v1Bytes2 = _v6ToV1(v6Bytes);
  return typeof uuid === "string" ? unsafeStringify(v1Bytes2) : v1Bytes2;
}
function _v6ToV1(v6Bytes) {
  return Uint8Array.of((v6Bytes[3] & 15) << 4 | v6Bytes[4] >> 4 & 15, (v6Bytes[4] & 15) << 4 | (v6Bytes[5] & 240) >> 4, (v6Bytes[5] & 15) << 4 | v6Bytes[6] & 15, v6Bytes[7], (v6Bytes[1] & 15) << 4 | (v6Bytes[2] & 240) >> 4, (v6Bytes[2] & 15) << 4 | (v6Bytes[3] & 240) >> 4, 16 | (v6Bytes[0] & 240) >> 4, (v6Bytes[0] & 15) << 4 | (v6Bytes[1] & 240) >> 4, v6Bytes[8], v6Bytes[9], v6Bytes[10], v6Bytes[11], v6Bytes[12], v6Bytes[13], v6Bytes[14], v6Bytes[15]);
}
var init_v6ToV1 = __esm({
  "node_modules/uuid/dist-node/v6ToV1.js"() {
    init_parse();
    init_stringify();
  }
});

// node_modules/uuid/dist-node/v7.js
function v7(options, buf, offset) {
  var _a;
  let bytes;
  if (options) {
    bytes = v7Bytes(options.random ?? ((_a = options.rng) == null ? void 0 : _a.call(options)) ?? rng(), options.msecs, options.seq, buf, offset);
  } else {
    const now = Date.now();
    const rnds = rng();
    updateV7State(_state2, now, rnds);
    bytes = v7Bytes(rnds, _state2.msecs, _state2.seq, buf, offset);
  }
  return buf ?? unsafeStringify(bytes);
}
function updateV7State(state, now, rnds) {
  state.msecs ??= -Infinity;
  state.seq ??= 0;
  if (now > state.msecs) {
    state.seq = rnds[6] << 23 | rnds[7] << 16 | rnds[8] << 8 | rnds[9];
    state.msecs = now;
  } else {
    state.seq = state.seq + 1 | 0;
    if (state.seq === 0) {
      state.msecs++;
    }
  }
  return state;
}
function v7Bytes(rnds, msecs, seq, buf, offset = 0) {
  if (rnds.length < 16) {
    throw new Error("Random bytes length must be >= 16");
  }
  if (!buf) {
    buf = new Uint8Array(16);
    offset = 0;
  } else {
    if (offset < 0 || offset + 16 > buf.length) {
      throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`);
    }
  }
  msecs ??= Date.now();
  seq ??= rnds[6] * 127 << 24 | rnds[7] << 16 | rnds[8] << 8 | rnds[9];
  buf[offset++] = msecs / 1099511627776 & 255;
  buf[offset++] = msecs / 4294967296 & 255;
  buf[offset++] = msecs / 16777216 & 255;
  buf[offset++] = msecs / 65536 & 255;
  buf[offset++] = msecs / 256 & 255;
  buf[offset++] = msecs & 255;
  buf[offset++] = 112 | seq >>> 28 & 15;
  buf[offset++] = seq >>> 20 & 255;
  buf[offset++] = 128 | seq >>> 14 & 63;
  buf[offset++] = seq >>> 6 & 255;
  buf[offset++] = seq << 2 & 255 | rnds[10] & 3;
  buf[offset++] = rnds[11];
  buf[offset++] = rnds[12];
  buf[offset++] = rnds[13];
  buf[offset++] = rnds[14];
  buf[offset++] = rnds[15];
  return buf;
}
var _state2, v7_default;
var init_v7 = __esm({
  "node_modules/uuid/dist-node/v7.js"() {
    init_rng();
    init_stringify();
    _state2 = {};
    v7_default = v7;
  }
});

// node_modules/uuid/dist-node/version.js
function version(uuid) {
  if (!validate_default(uuid)) {
    throw TypeError("Invalid UUID");
  }
  return parseInt(uuid.slice(14, 15), 16);
}
var version_default;
var init_version = __esm({
  "node_modules/uuid/dist-node/version.js"() {
    init_validate();
    version_default = version;
  }
});

// node_modules/uuid/dist-node/index.js
var dist_node_exports = {};
__export(dist_node_exports, {
  MAX: () => max_default,
  NIL: () => nil_default,
  parse: () => parse_default,
  stringify: () => stringify_default,
  v1: () => v1_default,
  v1ToV6: () => v1ToV6,
  v3: () => v3_default,
  v4: () => v4_default,
  v5: () => v5_default,
  v6: () => v6_default,
  v6ToV1: () => v6ToV1,
  v7: () => v7_default,
  validate: () => validate_default,
  version: () => version_default
});
var init_dist_node = __esm({
  "node_modules/uuid/dist-node/index.js"() {
    init_max();
    init_nil();
    init_parse();
    init_stringify();
    init_v1();
    init_v1ToV6();
    init_v3();
    init_v4();
    init_v5();
    init_v6();
    init_v6ToV1();
    init_v7();
    init_validate();
    init_version();
  }
});

// functions/admin/index.ts
var index_exports = {};
__export(index_exports, {
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

// functions/admin/index.ts
import_wx_server_sdk2.default.init({ env: import_wx_server_sdk2.default.DYNAMIC_CURRENT_ENV });
var ADMIN_TOKEN = "happyhome-admin-2024";
async function route(action, params) {
  if (action === "community.list") {
    const [active, pending] = await Promise.all([
      query("communities", { status: "active" }, { orderBy: ["createdAt", "desc"] }),
      query("communities", { status: "pending" }, { orderBy: ["createdAt", "desc"] })
    ]);
    return { communities: [...active, ...pending] };
  }
  if (action === "community.approve") {
    await updateById("communities", params.communityId, { status: "active" });
    return { success: true };
  }
  if (action === "community.reject") {
    await updateById("communities", params.communityId, { status: "disabled" });
    return { success: true };
  }
  if (action === "section.list") {
    const sections = await query("sections", { communityId: params.communityId }, { orderBy: ["order", "asc"] });
    return { sections };
  }
  if (action === "section.create") {
    const sectionId = await create("sections", {
      communityId: params.communityId,
      name: params.name,
      icon: params.icon || "",
      order: params.order ?? 0,
      enableComment: true,
      enableLike: true,
      widgets: [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { sectionId };
  }
  if (action === "section.get") {
    const section = await getById("sections", params.sectionId);
    return { section };
  }
  if (action === "section.updateWidgets") {
    const { v4: uuidv4 } = await Promise.resolve().then(() => (init_dist_node(), dist_node_exports));
    const widgets = (params.widgets || []).map((w) => ({
      ...w,
      widgetId: w.widgetId || uuidv4()
    }));
    const showInListCount = widgets.filter((w) => w.showInList).length;
    if (showInListCount > 3) throw new Error("showInList \u6700\u591A\u53EA\u80FD\u6709 3 \u4E2A\u63A7\u4EF6");
    await updateById("sections", params.sectionId, { widgets });
    return { widgets };
  }
  if (action === "member.pendingList") {
    const members = await query("community_members", {
      communityId: params.communityId,
      status: "pending"
    });
    return { members };
  }
  if (action === "member.approve") {
    await updateById("community_members", params.memberId, {
      status: "active",
      joinedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    await increment("communities", params.communityId, "memberCount", 1);
    return { success: true };
  }
  if (action === "member.reject") {
    await updateById("community_members", params.memberId, {
      status: "rejected",
      rejectedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { success: true };
  }
  throw new Error(`Unknown action: ${action}`);
}
var main = async (event) => {
  var _a, _b;
  if (event.httpMethod) {
    const auth = ((_a = event.headers) == null ? void 0 : _a.authorization) || ((_b = event.headers) == null ? void 0 : _b.Authorization) || "";
    if (auth !== `Bearer ${ADMIN_TOKEN}`) {
      return { statusCode: 403, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Unauthorized" }) };
    }
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
    }
    const { action: action2, ...params2 } = body;
    try {
      const result = await route(action2, params2);
      return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(result) };
    } catch (e) {
      return { statusCode: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: e.message }) };
    }
  }
  const { action, ...params } = event;
  return route(action, params);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
