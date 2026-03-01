import os from "node:os";
import path from "node:path";

const PI_CODING_AGENT_DIR =
	process.env["PI_CODING_AGENT_DIR"] || path.join(os.homedir(), ".pi", "agent");

export const CACHE_DIR = path.join(
	PI_CODING_AGENT_DIR,
	"cache",
	"pi-cursor-auth",
);
export const MODELS_CACHE_FILE = path.join(CACHE_DIR, "models.json");
export const MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
