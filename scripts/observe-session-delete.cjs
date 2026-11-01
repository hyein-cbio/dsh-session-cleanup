// Test-only preload: record real Linux rmSync calls without replacing deletion.
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const { resolve } = require("node:path");

const targets = new Set(JSON.parse(process.env.DSH_COMPAT_DELETE_TARGETS));
const trace = process.env.DSH_COMPAT_DELETE_TRACE;
const workspace = process.env.DSH_COMPAT_DELETE_WORKSPACE;
const cwd = fs.realpathSync(process.env.DSH_COMPAT_CWD);
const original = fs.rmSync;

function record(event, target) {
  const data = JSON.parse(fs.readFileSync(workspace, "utf8"));
  const ids = [];
  for (const row of Object.values(data.tables.workspaces)) {
    if (typeof row.path === "string" && fs.existsSync(row.path) && fs.realpathSync(row.path) === cwd) {
      ids.push(...(row.sessionIds || []));
    }
  }
  fs.appendFileSync(trace, JSON.stringify({
    event, target, exists: fs.existsSync(target), ids,
  }) + "\n");
}

fs.rmSync = function (target, ...args) {
  // The plugin passes absolute string paths. Do not interfere with other calls.
  const observed = typeof target === "string" && targets.has(resolve(target));
  if (observed) record("before-delete", resolve(target));
  try {
    return original.call(this, target, ...args);
  } finally {
    if (observed) record("after-delete", resolve(target));
  }
};
// The packed plugin uses an ESM named import from node:fs.
syncBuiltinESMExports();
