import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SessionCleanupConfig {
  enabled: boolean;
}

const DEFAULT_CONFIG: SessionCleanupConfig = {
  enabled: true,
};

function resolveExtensionRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function readConfigFile(configPath: string): Record<string, unknown> | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall back to defaults when config parsing fails.
    return null;
  }

  return null;
}

function ensureConfigFile(configPath: string): boolean {
  if (existsSync(configPath)) {
    return true;
  }

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
  } catch {
    // Best-effort config creation: fall back to in-memory defaults when the
    // filesystem is read-only or the path is unavailable.
    return false;
  }

  return true;
}

export function loadSessionCleanupConfig(): SessionCleanupConfig {
  const configPath = join(resolveExtensionRoot(), "config.json");
  ensureConfigFile(configPath);

  const raw = readConfigFile(configPath);
  if (!raw) {
    return { ...DEFAULT_CONFIG };
  }

  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_CONFIG.enabled;
  return { enabled };
}
