import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ForgeConfigSchema, type ForgeConfig } from "./schema.js";

/** Raised for any user-fixable config problem. CLI renders `.message` as the actionable error. */
export class ConfigError extends Error {}

const ENV_REF = /\$\{([A-Z0-9_]+)\}/g;

/**
 * Recursively interpolate `${VAR}` in string values from process.env.
 * Collects every missing variable so the user sees them all at once (PRD F53: actionable errors).
 */
function interpolateEnv(value: unknown, missing: Set<string>): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_REF, (_match, name: string) => {
      const resolved = process.env[name];
      if (resolved === undefined) {
        missing.add(name);
        return "";
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolateEnv(v, missing));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolateEnv(v, missing)]),
    );
  }
  return value;
}

/** Load, env-interpolate, and validate an agent.yaml. Throws ConfigError with a clear message. */
export function loadConfig(path: string): { config: ForgeConfig; path: string } {
  const abs = resolve(path);

  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    throw new ConfigError(`Cannot read config file: ${abs}`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    throw new ConfigError(`Invalid YAML in ${abs}: ${(e as Error).message}`);
  }

  const missing = new Set<string>();
  const interpolated = interpolateEnv(parsed, missing);
  if (missing.size > 0) {
    throw new ConfigError(
      `Missing environment variable(s) referenced in ${abs}:\n` +
        [...missing].map((v) => `  - ${v}`).join("\n") +
        `\nSet them in your environment or .env file.`,
    );
  }

  const result = ForgeConfigSchema.safeParse(interpolated);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config in ${abs}:\n${issues}`);
  }

  return { config: result.data, path: abs };
}
