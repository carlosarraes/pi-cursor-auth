import fs from "node:fs";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelDetails } from "../__generated__/agent/v1/agent_pb";
import type AiService from "../api/ai-service";
import { CURSOR_API_URL } from "../lib/env";
import { CACHE_DIR, MODELS_CACHE_FILE, MODELS_CACHE_TTL_MS } from "./env";
import { toCanonicalId } from "./model-mapping";
import { findPiModelOverride, type PiModelOverride } from "./model-override";

interface CachedModelsFile {
	models: ModelDetails[];
	lastUpdatedAt?: string;
}

let updateInFlight: Promise<void> | null = null;

const toPiModel = (
	id: string,
	model: ModelDetails,
	override: PiModelOverride,
) => ({
	id,
	name: `${model.displayName} (Cursor)`,
	api: "cursor-agent",
	provider: "cursor-agent",
	baseUrl: CURSOR_API_URL,
	...override,
});

const readCache = (): CachedModelsFile | undefined => {
	try {
		if (!fs.existsSync(MODELS_CACHE_FILE)) return undefined;
		return JSON.parse(
			fs.readFileSync(MODELS_CACHE_FILE, "utf8"),
		) as CachedModelsFile;
	} catch {
		return undefined;
	}
};

const isCacheStale = (cache: CachedModelsFile | undefined): boolean => {
	if (!cache?.lastUpdatedAt) return true;
	const ts = Date.parse(cache.lastUpdatedAt);
	return Number.isNaN(ts) || Date.now() - ts >= MODELS_CACHE_TTL_MS;
};

export const getCachedPiModels = (): Model<Api>[] =>
	(readCache()?.models ?? []).flatMap((model) => {
		const canonicalId = toCanonicalId(model.modelId);
		if (!canonicalId) return [];
		return [toPiModel(canonicalId, model, findPiModelOverride(canonicalId))];
	});

export const updateCachedPiModels = async (ai: AiService) => {
	const [response] = await Promise.all([
		ai.getUsableModels(),
		fs.promises.mkdir(CACHE_DIR, { recursive: true }),
	]);
	const payload: CachedModelsFile = {
		models: response.models,
		lastUpdatedAt: new Date().toISOString(),
	};
	await fs.promises.writeFile(
		MODELS_CACHE_FILE,
		JSON.stringify(payload, null, 2),
	);
};

export const updateCachedPiModelsIfStale = async (ai: AiService) => {
	if (updateInFlight) {
		await updateInFlight;
		return;
	}
	if (!isCacheStale(readCache())) return;
	updateInFlight = updateCachedPiModels(ai).finally(() => {
		updateInFlight = null;
	});
	await updateInFlight;
};
