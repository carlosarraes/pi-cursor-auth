import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ConversationStateStructure } from "./__generated__/agent/v1/agent_pb";
import {
	AskQuestionRejected,
	AskQuestionResult,
} from "./__generated__/agent/v1/ask_question_tool_pb";
import AgentService from "./api/agent-service";
import {
	CURSOR_API_URL,
	CURSOR_CLIENT_TYPE,
	CURSOR_CLIENT_VERSION,
} from "./lib/env";
import {
	CURSOR_STATE_ENTRY_TYPE,
	ensureAgentStore,
	persistAgentStore,
} from "./pi/agent-store";
import {
	appendCursorTextDelta,
	appendCursorThinkingDelta,
	type CursorStreamState,
	createCursorStreamState,
	finalizeCursorStreamState,
	synthesizeCursorExecToolCall,
} from "./pi/cursor-stream-state";
import {
	LocalResourceProvider,
	type PiToolContext,
	type ToolExecEvent,
} from "./pi/local-resource-provider";
import { toCursorId } from "./pi/model-mapping";
import { buildRunRequest, getContextTools } from "./pi/request-builder";
import {
	AgentConnectClient,
	type CheckpointHandler,
	type InteractionListener,
} from "./vendor/agent-client";
import type {
	CoreInteractionQuery,
	CoreInteractionResponse,
	CoreInteractionUpdate,
} from "./vendor/agent-core";

function createCheckpointHandler(
	handler: (checkpoint: ConversationStateStructure) => void,
): CheckpointHandler {
	return {
		handleCheckpoint(
			_ctx: unknown,
			checkpoint: ConversationStateStructure,
		): Promise<void> {
			handler(checkpoint);
			return Promise.resolve();
		},
	};
}

const QUERY_REJECTION_REASON = "Not supported by pi-cursor-auth";

function createInteractionListenerAdapter(
	onUpdate: (update: CoreInteractionUpdate) => void,
): InteractionListener {
	return {
		async sendUpdate(
			_ctx: unknown,
			update: CoreInteractionUpdate,
		): Promise<void> {
			onUpdate(update);
		},

		async query(
			_ctx: unknown,
			query: CoreInteractionQuery,
		): Promise<CoreInteractionResponse> {
			switch (query.type) {
				case "ask-question-request":
					return {
						result: new AskQuestionResult({
							result: {
								case: "rejected",
								value: new AskQuestionRejected({
									reason: QUERY_REJECTION_REASON,
								}),
							},
						}),
					};
				case "web-search-request":
				case "web-fetch-request":
				case "exa-search-request":
				case "exa-fetch-request":
				case "switch-mode-request":
					return { approved: false, reason: QUERY_REJECTION_REASON };
				case "create-plan-request":
					return {
						result: {
							planUri: "",
							result: {
								case: "error",
								value: { error: QUERY_REJECTION_REASON },
							},
						},
					} as CoreInteractionResponse;
				case "setup-vm-environment-request":
					return {} as CoreInteractionResponse;
				default:
					return { approved: false, reason: QUERY_REJECTION_REASON };
			}
		},
	};
}

type CursorAssistantMessage = AssistantMessage & {
	duration?: number;
	ttft?: number;
};

export function streamCursorAgent(
	pi: ExtensionAPI,
	getCtx: () => ExtensionContext | null,
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const startTime = Date.now();
		let cursorStreamState: CursorStreamState | undefined;

		const output: CursorAssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		const sessionId = options?.sessionId ?? "default";

		try {
			const apiKey = options?.apiKey;
			if (!apiKey) {
				throw new Error(
					"Cursor API key (access token) is required. Run /login cursor or set CURSOR_ACCESS_TOKEN.",
				);
			}

			const agentStore = await ensureAgentStore(sessionId);
			const cwd = getCtx()?.cwd ?? process.cwd();
			const requestContextTools = getContextTools(context);

			let onToolExec: ((event: ToolExecEvent) => void) | undefined;
			const activeTools = new Set<string>(
				pi.getActiveTools() as Iterable<string>,
			);

			const piToolCtx: PiToolContext = {
				cwd,
				...(options?.signal ? { signal: options.signal } : {}),
				getActiveTools: () => activeTools,
				getCtx,
				onToolExec: (event) => onToolExec?.(event),
			};

			const resources = new LocalResourceProvider({
				ctx: piToolCtx,
				requestContextTools,
			});

			const blobStore = agentStore.getBlobStore();
			const cursorModelId = toCursorId(model.id, options?.reasoning);
			const { initialRequest, conversationState } = buildRunRequest({
				model: { ...model, id: cursorModelId },
				context,
				conversationId: agentStore.getId(),
				blobStore,
				conversationState: agentStore.getConversationStateStructure(),
				mcpToolDefinitions: requestContextTools,
			});
			agentStore.conversationStateStructure = conversationState;

			stream.push({ type: "start", partial: output });
			const state = createCursorStreamState(output, stream);
			cursorStreamState = state;
			const usageState = { sawTokenDelta: false };

			onToolExec = (event: ToolExecEvent) => {
				if (event.type === "start") {
					synthesizeCursorExecToolCall(
						state,
						event.toolCallId,
						event.toolName,
						event.args,
					);
				}
			};

			const handleInteractionUpdate = (update: CoreInteractionUpdate) => {
				switch (update.type) {
					case "text-delta": {
						appendCursorTextDelta(state, update.text);
						return;
					}

					case "thinking-delta": {
						appendCursorThinkingDelta(state, update.text);
						return;
					}

					case "thinking-completed": {
						if (state.currentThinkingBlock) {
							finalizeCursorStreamState(state);
						}
						return;
					}

					case "turn-ended": {
						output.stopReason = "stop";
						return;
					}

					case "token-delta": {
						usageState.sawTokenDelta = true;
						output.usage.output += update.tokens;
						output.usage.totalTokens = output.usage.input + output.usage.output;
						return;
					}
				}
			};

			const baseUrl = model.baseUrl || CURSOR_API_URL;
			const agentService = new AgentService(baseUrl, {
				accessToken: apiKey,
				clientVersion: CURSOR_CLIENT_VERSION,
				clientType: CURSOR_CLIENT_TYPE,
			});

			const connectClient = new AgentConnectClient(agentService.rpcClient);

			const interactionListener = createInteractionListenerAdapter(
				handleInteractionUpdate,
			);

			const checkpointHandler = createCheckpointHandler(
				(checkpoint: ConversationStateStructure) => {
					void agentStore.handleCheckpoint(null, checkpoint);
					const usedTokens = checkpoint.tokenDetails?.usedTokens ?? 0;
					if (usedTokens <= 0) return;

					if (!usageState.sawTokenDelta && output.usage.output !== usedTokens) {
						output.usage.output = usedTokens;
					}

					// Cursor reports the full conversation context in checkpoint tokenDetails.
					// Pi uses assistant usage.totalTokens as the latest context-size anchor.
					output.usage.totalTokens = usedTokens;
					output.usage.input = Math.max(usedTokens - output.usage.output, 0);
				},
			);
			checkpointHandler.getLatestCheckpoint = () =>
				agentStore.getConversationStateStructure();

			const runOptions: Parameters<typeof connectClient.run>[1] = {
				interactionListener,
				resources,
				blobStore,
				checkpointHandler,
			};
			if (options?.signal) runOptions.signal = options.signal;

			await connectClient.run(initialRequest, runOptions);

			finalizeCursorStreamState(state);

			output.usage.cost = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			};
			output.duration = Date.now() - startTime;
			if (state.firstTokenTime) {
				output.ttft = state.firstTokenTime - startTime;
			}

			stream.push({ type: "done", reason: "stop", message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage =
				error instanceof Error ? error.message : String(error);
			output.duration = Date.now() - startTime;
			if (cursorStreamState?.firstTokenTime) {
				output.ttft = cursorStreamState.firstTokenTime - startTime;
			}
			const errorReason = output.stopReason === "aborted" ? "aborted" : "error";
			stream.push({
				type: "error",
				reason: errorReason,
				error: output,
			});
			stream.end();
		} finally {
			try {
				const snapshot = await persistAgentStore(sessionId);
				if (snapshot) {
					pi.appendEntry(CURSOR_STATE_ENTRY_TYPE, snapshot);
				}
			} catch (err) {
				console.error("[pi-cursor-auth] failed to persist agent store:", err);
			}
		}
	})();

	return stream;
}
