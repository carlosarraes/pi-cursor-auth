import type { ThinkingLevel } from "@mariozechner/pi-ai";

const MODEL_MAP: Record<string, Record<string, string>> = {
	"claude-sonnet-4-5": {
		default: "claude-4.5-sonnet",
		minimal: "claude-4.5-sonnet-thinking",
		low: "claude-4.5-sonnet-thinking",
		medium: "claude-4.5-sonnet-thinking",
		high: "claude-4.5-sonnet-thinking",
		xhigh: "claude-4.5-sonnet-thinking",
	},
	"claude-opus-4-5": {
		default: "claude-4.5-opus-high",
		minimal: "claude-4.5-opus-high-thinking",
		low: "claude-4.5-opus-high-thinking",
		medium: "claude-4.5-opus-high-thinking",
		high: "claude-4.5-opus-high-thinking",
		xhigh: "claude-4.5-opus-high-thinking",
	},
	"claude-opus-4-6": {
		default: "claude-4.6-opus-high",
		minimal: "claude-4.6-opus-high-thinking",
		low: "claude-4.6-opus-high-thinking",
		medium: "claude-4.6-opus-high-thinking",
		high: "claude-4.6-opus-high-thinking",
		xhigh: "claude-4.6-opus-high-thinking",
	},
	"gpt-5.2-codex": {
		default: "gpt-5.2-codex",
		minimal: "gpt-5.2-codex-low",
		low: "gpt-5.2-codex-low",
		high: "gpt-5.2-codex-high",
		xhigh: "gpt-5.2-codex-xhigh",
	},
	"gpt-5.2-codex-fast": {
		default: "gpt-5.2-codex-fast",
		minimal: "gpt-5.2-codex-low-fast",
		low: "gpt-5.2-codex-low-fast",
		high: "gpt-5.2-codex-high-fast",
		xhigh: "gpt-5.2-codex-xhigh-fast",
	},
	"gpt-5.3-codex": {
		default: "gpt-5.3-codex",
		minimal: "gpt-5.3-codex-low",
		low: "gpt-5.3-codex-low",
		high: "gpt-5.3-codex-high",
		xhigh: "gpt-5.3-codex-xhigh",
	},
	"gpt-5.3-codex-fast": {
		default: "gpt-5.3-codex-fast",
		minimal: "gpt-5.3-codex-low-fast",
		low: "gpt-5.3-codex-low-fast",
		high: "gpt-5.3-codex-high-fast",
		xhigh: "gpt-5.3-codex-xhigh-fast",
	},
	"gpt-5.2": {
		default: "gpt-5.2",
		high: "gpt-5.2-high",
		xhigh: "gpt-5.2-high",
	},
	"gpt-5.1": {
		default: "gpt-5.1-high",
	},
	"gpt-5.1-codex-max": {
		default: "gpt-5.1-codex-max",
		high: "gpt-5.1-codex-max-high",
		xhigh: "gpt-5.1-codex-max-high",
	},
	"gemini-3-pro-preview": { default: "gemini-3-pro" },
	"gemini-3-flash-preview": { default: "gemini-3-flash" },
	"grok-code-fast-1": { default: "grok-code-fast-1" },
};

const cursorDefaultToCanonical = new Map<string, string>();
const allMappedCursorIds = new Set<string>();

for (const [canonicalId, variants] of Object.entries(MODEL_MAP)) {
	const defaultId = variants["default"];
	if (defaultId) cursorDefaultToCanonical.set(defaultId, canonicalId);
	for (const cursorId of Object.values(variants)) {
		if (cursorId) allMappedCursorIds.add(cursorId);
	}
}

export function toCanonicalId(cursorId: string): string | null {
	const canonical = cursorDefaultToCanonical.get(cursorId);
	if (canonical) return canonical;
	if (allMappedCursorIds.has(cursorId)) return null;
	return cursorId;
}

export function toCursorId(
	canonicalId: string,
	reasoning?: ThinkingLevel,
): string {
	const family = MODEL_MAP[canonicalId];
	if (!family) return canonicalId;
	const defaultId = family["default"] ?? canonicalId;
	if (!reasoning) return defaultId;
	return family[reasoning] ?? defaultId;
}

export function getCursorModelFlags(cursorModelId: string) {
	return {
		isThinking: cursorModelId.includes("-thinking"),
		isMaxMode:
			cursorModelId.includes("-high") || cursorModelId.includes("-xhigh"),
	};
}
