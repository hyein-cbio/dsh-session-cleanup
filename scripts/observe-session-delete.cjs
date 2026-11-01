// Test-only preload: record real removal/Trash operations without replacing them.
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const { resolve } = require("node:path");

const targets = new Set(JSON.parse(process.env.DSH_COMPAT_DELETE_TARGETS));
const trace = process.env.DSH_COMPAT_DELETE_TRACE;
const workspace = process.env.DSH_COMPAT_DELETE_WORKSPACE;
const cwd = fs.realpathSync(process.env.DSH_COMPAT_CWD);
const childProcess = require("node:child_process");
const originalSpawn = childProcess.spawn;
const trashCommands = new Set(["trash", "trash-put", "gio", "kioclient5", "kioclient", "osascript"]);

function record(event, target, operation) {
  const data = JSON.parse(fs.readFileSync(workspace, "utf8"));
  const ids = [];
  for (const row of Object.values(data.tables.workspaces)) {
    if (typeof row.path === "string" && fs.existsSync(row.path) && fs.realpathSync(row.path) === cwd) {
      ids.push(...(row.sessionIds || []));
    }
  }
  fs.appendFileSync(trace, JSON.stringify({
    event, target, operation, exists: fs.existsSync(target), ids,
  }) + "\n");
}

for (const name of ["rmSync", "renameSync"]) {
  const original = fs[name];
  fs[name] = function (target, ...args) {
    // The plugin passes absolute string paths. Leave unrelated calls alone.
    const observed = typeof target === "string" && targets.has(resolve(target));
    if (observed) record("before-delete", resolve(target), name);
    try {
      return original.call(this, target, ...args);
    } finally {
      if (observed) record("after-delete", resolve(target), name);
    }
  };
}

childProcess.spawn = function (command, args, ...rest) {
  const observed = trashCommands.has(command) && Array.isArray(args)
    ? [...targets].filter(target => args.some(arg => typeof arg === "string" && (arg === target || arg.includes(JSON.stringify(target)))))
    : [];
  for (const target of observed) record("before-delete", target, command);
  let child;
  try {
    child = originalSpawn.call(this, command, args, ...rest);
  } catch (error) {
    for (const target of observed) record("after-delete", target, command);
    throw error;
  }
  // Registered before the plugin's close handler resolves its cleanup promise.
  child.once("close", () => {
    for (const target of observed) record("after-delete", target, command);
  });
  return child;
};
// The packed plugin uses ESM named imports from fs and child_process.
syncBuiltinESMExports();
