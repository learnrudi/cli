var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/agent-host/task-custody.js
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);
var import_node_child_process2 = require("node:child_process");

// src/agent-host/task-profile.js
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
function taskText(value, label, max = 4096) {
  if (typeof value !== "string" || !value.trim() || !value.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value) > max) {
    throw new Error(`${label} must be bounded valid text`);
  }
  return value;
}
function canonicalDirectory(value, label) {
  taskText(value, label);
  if (!import_node_path.default.isAbsolute(value) || import_node_path.default.normalize(value) !== value || /[\*?\[\]]/u.test(value) || import_node_fs.default.realpathSync(value) !== value || !import_node_fs.default.statSync(value).isDirectory()) {
    throw new Error(`${label} must be an existing canonical directory without aliases or glob characters`);
  }
  return value;
}
function readTaskRegularFile(filename, maximum, singleLink = false) {
  const flags = import_node_fs.default.constants.O_RDONLY | import_node_fs.default.constants.O_NOFOLLOW | import_node_fs.default.constants.O_NONBLOCK;
  const fd = import_node_fs.default.openSync(filename, flags);
  try {
    const before = import_node_fs.default.fstatSync(fd);
    if (!before.isFile() || before.size > maximum || singleLink && before.nlink !== 1) {
      throw new Error("invalid bounded regular file or hardlink");
    }
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size <= maximum) {
      const count = import_node_fs.default.readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = import_node_fs.default.fstatSync(fd);
    if (size > maximum || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("file overflow or changed during verification");
    }
    return buffer.subarray(0, size);
  } finally {
    import_node_fs.default.closeSync(fd);
  }
}
function parseTaskJson(source) {
  const value = JSON.parse(source, (_key, entry) => {
    if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error("non-finite task JSON");
    return entry;
  });
  const stack = [];
  for (const [token] of source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]/gu)) {
    const frame = stack.at(-1);
    if (token === "{") stack.push({ keys: /* @__PURE__ */ new Set(), key: true });
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && frame) frame.key = true;
    else if (token.startsWith('"') && frame?.key) {
      const key = JSON.parse(token);
      if (frame.keys.has(key)) throw new Error("duplicate task JSON key");
      frame.keys.add(key);
      frame.key = false;
    }
  }
  return value;
}

// src/agent-host/task-audit.js
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_url = require("node:url");
var import_node_child_process = require("node:child_process");
var import_meta = {};
function isQualifiedTaskAuditHost() {
  return process.platform === "darwin" && import_node_os.default.release().startsWith("24.") && process.arch === "x64";
}
function auditHelperPath() {
  if (!isQualifiedTaskAuditHost()) throw new Error("task audit containment requires the qualified Darwin 24 x64 host");
  const entry = process.argv[1] || "";
  const helper = entry.endsWith(".cjs") ? import_node_path2.default.join(import_node_path2.default.dirname(entry), "task-audit-darwin") : (0, import_node_url.fileURLToPath)(new URL("../../dist/task-audit-darwin", import_meta.url));
  const stat = import_node_fs2.default.lstatSync(helper);
  if (!stat.isFile() || stat.nlink !== 1 || import_node_fs2.default.realpathSync(helper) !== helper) throw new Error("invalid task audit helper");
  import_node_fs2.default.accessSync(helper, import_node_fs2.default.constants.X_OK);
  return helper;
}
function invoke(args) {
  return JSON.parse((0, import_node_child_process.execFileSync)(auditHelperPath(), args, {
    encoding: "utf8",
    timeout: 5e3,
    maxBuffer: 16384,
    env: { PATH: "/usr/bin:/bin" },
    stdio: ["ignore", "pipe", "pipe"]
  }));
}
function auditIdentity(pid) {
  return invoke(["identity", String(pid)]);
}
function validateAuditIdentity(value) {
  if (!value || Object.keys(value).sort().join(",") !== "asid,pid,uid,unique,version" || ![value.pid, value.version, value.asid, value.uid].every(Number.isSafeInteger) || value.pid < 2 || value.version < 1 || value.asid < 1e5 || value.uid !== process.getuid() || !/^[1-9][0-9]{0,19}$/u.test(value.unique) || BigInt(value.unique) > 18446744073709551615n) throw new Error("invalid task audit identity");
  return value;
}
async function drainAuditScope(scope, guardian = null) {
  if (scope?.schema_version !== 1) throw new Error("invalid audit scope");
  const owner = validateAuditIdentity(scope.owner);
  if (guardian && validateAuditIdentity(guardian).asid !== owner.asid) throw new Error("guardian audit scope mismatch");
  const args = [
    "sweep",
    owner.asid,
    owner.unique,
    owner.pid,
    owner.version,
    guardian?.pid || 0,
    guardian?.version || 0,
    9
  ].map(String);
  const end = Date.now() + 7e3;
  let quiet = false;
  let last;
  while (Date.now() < end) {
    const result = invoke(args);
    last = result;
    const empty = result.members === 0 && result.uncertain === 0;
    if (empty && quiet) return;
    quiet = empty;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`audit session drain unconfirmed; custody blocked: ${JSON.stringify(last)}`);
}

// src/agent-host/task-custody.js
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error("invalid custody PID");
  try {
    const value = (0, import_node_child_process2.execFileSync)(
      "/bin/ps",
      ["-p", String(pid), "-o", "pid=,pgid=,uid=,lstart="],
      { encoding: "utf8", timeout: 2e3, maxBuffer: 4096, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    const match = value.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u);
    if (!match) throw new Error("invalid process identity");
    const boot = process.platform === "linux" ? import_node_fs3.default.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() : (0, import_node_child_process2.execFileSync)(
      "/usr/sbin/sysctl",
      ["-n", "kern.bootsessionuuid"],
      { encoding: "utf8", timeout: 2e3, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    return { pid: Number(match[1]), pgid: Number(match[2]), uid: Number(match[3]), started: match[4], boot };
  } catch (error) {
    if (error.status === 1 && !String(error.stdout || "").trim()) return null;
    throw new Error("cannot establish process identity");
  }
}
function sameProcess(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function record(directory, name, value) {
  const fd = import_node_fs3.default.openSync(import_node_path3.default.join(directory, name), "wx", 384);
  try {
    import_node_fs3.default.writeFileSync(fd, `${JSON.stringify(value)}
`);
    import_node_fs3.default.fsyncSync(fd);
  } finally {
    import_node_fs3.default.closeSync(fd);
  }
}
function read(directory, name) {
  return parseTaskJson(readTaskRegularFile(import_node_path3.default.join(directory, name), 16384, true).toString("utf8"));
}
function quarantineTaskCustody(directory, reason) {
  try {
    record(directory, "quarantine.json", { reason, at: (/* @__PURE__ */ new Date()).toISOString() });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    read(directory, "quarantine.json");
  }
}
function validateIdentity(value) {
  if (!value || !Number.isSafeInteger(value.pid) || value.pid < 2 || !Number.isSafeInteger(value.pgid) || value.uid !== process.getuid() || typeof value.started !== "string" || typeof value.boot !== "string" || Object.keys(value).sort().join(",") !== "boot,pgid,pid,started,uid") throw new Error("invalid custody identity");
  return value;
}
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
async function stopOwnedNative(directory) {
  if (import_node_fs3.default.existsSync(import_node_path3.default.join(directory, "session.json"))) {
    const scope = read(directory, "session.json");
    if (read(directory, "owner.json").process.boot !== processIdentity(process.pid).boot) return;
    const guardian = import_node_fs3.default.existsSync(import_node_path3.default.join(directory, "guardian-audit.json")) ? read(directory, "guardian-audit.json") : null;
    await drainAuditScope(scope, guardian);
    return;
  }
  const native = validateIdentity(read(directory, "native.json"));
  if (native.pid !== native.pgid) throw new Error("native custody requires its own process group");
  const currentBoot = processIdentity(process.pid).boot;
  if (native.boot !== currentBoot) return;
  for (const [signal, budget] of [["SIGTERM", 5e3], ["SIGKILL", 2e3]]) {
    if (!groupAlive(native.pgid)) return;
    if (!sameProcess(processIdentity(native.pid), native)) throw new Error("native group ownership ambiguous; custody blocked");
    process.kill(-native.pgid, signal);
    const end = Date.now() + budget;
    while (Date.now() < end) {
      if (!groupAlive(native.pgid)) return;
      await delay(50);
    }
  }
  throw new Error("native process group did not exit; custody blocked");
}
async function runTaskWatchdog(directory) {
  canonicalDirectory(directory, "custody directory");
  const owner = validateIdentity(read(directory, "owner.json").process);
  if (owner.pid !== process.ppid || !sameProcess(processIdentity(owner.pid), owner) || !process.send) throw new Error("watchdog requires its verified parent IPC");
  record(directory, "guardian.json", processIdentity(process.pid));
  if (import_node_fs3.default.existsSync(import_node_path3.default.join(directory, "session.json"))) record(directory, "guardian-audit.json", validateAuditIdentity(auditIdentity(process.pid)));
  let stopping = false;
  const cleanup = async (normal = false) => {
    if (stopping) return;
    stopping = true;
    try {
      let quarantineError;
      if (!normal) try {
        quarantineTaskCustody(directory, "supervisor lost; task outcome requires reconciliation");
      } catch (error) {
        quarantineError = error;
      }
      await stopOwnedNative(directory);
      record(directory, "orphan-cleanup.json", { native_group_gone: true, audit_session_drained: import_node_fs3.default.existsSync(import_node_path3.default.join(directory, "session.json")), mode: normal && !import_node_fs3.default.existsSync(import_node_path3.default.join(directory, "quarantine.json")) ? "normal" : "quarantined", at: (/* @__PURE__ */ new Date()).toISOString() });
      process.exit(quarantineError ? 1 : 0);
    } catch {
      process.exit(1);
    }
  };
  process.once("disconnect", () => void cleanup());
  process.once("message", (message) => {
    if (message === "done" || message === "abort") void cleanup(message === "done");
  });
  process.once("SIGTERM", () => void cleanup());
  process.once("SIGINT", () => void cleanup());
  process.send("ready");
}

// src/agent-host/task-custody-worker.js
runTaskWatchdog(process.argv[2]).catch(() => process.exit(1));
