import { createHash } from "node:crypto";
import { type JsonValue, Value } from "@bufbuild/protobuf";
import type {
	Api,
	Context,
	Message,
	Model,
	TextContent,
	Tool,
	ToolResultMessage,
} from "@mariozechner/pi-ai";
import {
	AgentClientMessage,
	AgentConversationTurnStructure,
	AgentMode,
	AgentRunRequest,
	AssistantMessage as AssistantMessageProto,
	ConversationAction,
	type ConversationStateStructure,
	ConversationStateStructure as ConversationStateStructureClass,
	ConversationStep,
	ConversationTurnStructure,
	ModelDetails,
	ThinkingDetails,
	UserMessage,
	UserMessageAction,
} from "../__generated__/agent/v1/agent_pb";
import {
	type McpToolDefinition,
	McpToolDefinition as McpToolDefinitionClass,
	McpTools,
} from "../__generated__/agent/v1/mcp_pb";
import { type BlobStore, getBlobId } from "../vendor/agent-kv";
import { getCursorModelFlags } from "./model-mapping";
import { toolResultToText } from "./utils/tool-result";

const CURSOR_NATIVE_TOOL_NAMES = new Set([
	"bash",
	"read",
	"write",
	"delete",
	"ls",
	"grep",
	"lsp",
	"todo_write",
]);

type ContextWithTools = Context & { tools?: Tool[] };

function extractUserMessageText(msg: Message): string {
	if (msg.role !== "user") return "";
	if (typeof msg.content === "string") return msg.content.trim();
	return msg.content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

function extractAssistantMessageText(msg: Message): string {
	if (msg.role !== "assistant") return "";
	if (!Array.isArray(msg.content)) return "";
	return msg.content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

function storeBlob(blobStore: BlobStore, data: Uint8Array): Uint8Array {
	const id = getBlobId(data);
	void blobStore.setBlob(null, id, data);
	return id;
}

function deterministicMessageId(key: string): string {
	const hex = createHash("sha256").update(key).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function findLastUserMessageIndex(messages: Message[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role === "user") return i;
	}
	return -1;
}

function buildRootPromptMessagesJson(
	messages: Message[],
	systemPromptId: Uint8Array,
	blobStore: BlobStore,
): Uint8Array[] {
	const entries: Uint8Array[] = [systemPromptId];
	const lastUserIdx = findLastUserMessageIndex(messages);

	const pushJson = (obj: unknown) => {
		const bytes = new TextEncoder().encode(JSON.stringify(obj));
		entries.push(storeBlob(blobStore, bytes));
	};

	for (let i = 0; i < messages.length; i++) {
		if (i === lastUserIdx) break;
		const msg = messages[i];
		if (!msg) continue;
		if (msg.role === "user") {
			const text = extractUserMessageText(msg);
			if (text) pushJson({ role: "user", content: [{ type: "text", text }] });
		} else if (msg.role === "assistant") {
			const text = extractAssistantMessageText(msg);
			if (text)
				pushJson({ role: "assistant", content: [{ type: "text", text }] });
		} else if (msg.role === "toolResult") {
			const text = toolResultToText(msg as ToolResultMessage);
			if (text)
				pushJson({
					role: "user",
					content: [{ type: "text", text: `[Tool Result]\n${text}` }],
				});
		}
	}

	return entries;
}

function buildConversationTurns(
	messages: Message[],
	blobStore: BlobStore,
): Uint8Array[] {
	const turns: Uint8Array[] = [];

	const lastUserIdx = findLastUserMessageIndex(messages);

	let i = 0;
	while (i < messages.length) {
		const msg = messages[i];
		if (!msg || msg.role !== "user") {
			i++;
			continue;
		}

		if (i === lastUserIdx) break;

		const userText = extractUserMessageText(msg);
		if (!userText) {
			i++;
			continue;
		}

		const userMessage = new UserMessage({
			text: userText,
			messageId: deterministicMessageId(`u:${turns.length}:${userText}`),
			mode: AgentMode.AGENT,
		});
		const userMessageBlobId = storeBlob(blobStore, userMessage.toBinary());

		const stepBlobIds: Uint8Array[] = [];
		i++;
		while (i < messages.length && messages[i]?.role !== "user") {
			const stepMsg = messages[i];
			if (!stepMsg) {
				i++;
				continue;
			}

			if (stepMsg.role === "assistant") {
				const text = extractAssistantMessageText(stepMsg);
				if (text) {
					const step = new ConversationStep({
						message: {
							case: "assistantMessage",
							value: new AssistantMessageProto({ text }),
						},
					});
					stepBlobIds.push(storeBlob(blobStore, step.toBinary()));
				}
			} else if (stepMsg.role === "toolResult") {
				const text = toolResultToText(stepMsg as ToolResultMessage);
				if (text) {
					const step = new ConversationStep({
						message: {
							case: "assistantMessage",
							value: new AssistantMessageProto({
								text: `[Tool Result]\n${text}`,
							}),
						},
					});
					stepBlobIds.push(storeBlob(blobStore, step.toBinary()));
				}
			}

			i++;
		}

		const agentTurn = new AgentConversationTurnStructure({
			userMessage: new Uint8Array(userMessageBlobId),
			steps: stepBlobIds.map((id) => new Uint8Array(id)),
		});
		const turn = new ConversationTurnStructure({
			turn: { case: "agentConversationTurn", value: agentTurn },
		});
		turns.push(storeBlob(blobStore, turn.toBinary()));
	}

	return turns;
}

function buildMcpToolDefinitions(
	tools: Tool[] | undefined,
): McpToolDefinition[] {
	if (!tools || tools.length === 0) {
		return [];
	}

	const advertisedTools = tools.filter(
		(tool) => !CURSOR_NATIVE_TOOL_NAMES.has(tool.name),
	);
	if (advertisedTools.length === 0) {
		return [];
	}

	return advertisedTools.map((tool) => {
		const jsonSchema = tool.parameters as Record<string, unknown> | undefined;
		const schemaValue: JsonValue =
			jsonSchema && typeof jsonSchema === "object"
				? (jsonSchema as JsonValue)
				: { type: "object", properties: {}, required: [] };
		const inputSchema = new Uint8Array(Value.fromJson(schemaValue).toBinary());
		return new McpToolDefinitionClass({
			name: tool.name,
			description: tool.description,
			providerIdentifier: "pi-agent",
			toolName: tool.name,
			inputSchema,
		});
	});
}

interface BuildRunRequestParams {
	model: Model<Api>;
	context: Context;
	conversationId: string;
	blobStore: BlobStore;
	conversationState: ConversationStateStructure | undefined;
	mcpToolDefinitions?: McpToolDefinition[];
}

interface BuildRunRequestResult {
	initialRequest: AgentClientMessage;
	conversationState: ConversationStateStructure;
}

export function buildRunRequest(
	params: BuildRunRequestParams,
): BuildRunRequestResult {
	const systemPromptJson = JSON.stringify({
		role: "system",
		content: params.context.systemPrompt || "You are a helpful assistant.",
	});
	const systemPromptBytes = new TextEncoder().encode(systemPromptJson);
	const systemPromptId = storeBlob(params.blobStore, systemPromptBytes);

	const lastMessage = params.context.messages.at(-1);
	const userText = lastMessage ? extractUserMessageText(lastMessage) : "";
	if (!userText) {
		throw new Error("Cannot send empty user message to Cursor API");
	}

	const userMessage = new UserMessage({
		text: userText,
		messageId: crypto.randomUUID(),
		mode: AgentMode.AGENT,
	});

	const action = new ConversationAction({
		action: {
			case: "userMessageAction",
			value: new UserMessageAction({ userMessage }),
		},
	});

	const cached = params.conversationState;
	const turns = buildConversationTurns(
		params.context.messages,
		params.blobStore,
	);
	const rootPromptMessages = buildRootPromptMessagesJson(
		params.context.messages,
		systemPromptId,
		params.blobStore,
	);

	const conversationState = new ConversationStateStructureClass({
		rootPromptMessagesJson: rootPromptMessages,
		turns,
		todos: cached?.todos ?? [],
		pendingToolCalls: cached?.pendingToolCalls ?? [],
		previousWorkspaceUris: cached?.previousWorkspaceUris ?? [],
		...(cached?.tokenDetails ? { tokenDetails: cached.tokenDetails } : {}),
		turnTimings: cached?.turnTimings ?? [],
		readPaths: cached?.readPaths ?? [],
		selfSummaryCount: cached?.selfSummaryCount ?? 0,
		// Clear fields that bloat during coding sessions
		fileStates: {},
		fileStatesV2: {},
		summaryArchives: [],
		subagentStates: {},
	});

	// FIX 3 & 4: Set thinkingDetails and maxMode on ModelDetails
	const flags = getCursorModelFlags(params.model.id);
	const modelDetails = new ModelDetails({
		modelId: params.model.id,
		displayModelId: params.model.id,
		displayName: params.model.name,
		...(flags.isThinking ? { thinkingDetails: new ThinkingDetails() } : {}),
		...(flags.isMaxMode ? { maxMode: true } : {}),
	});

	const mcpToolDefinitions = params.mcpToolDefinitions ?? [];
	const runRequest = new AgentRunRequest({
		conversationState,
		action,
		modelDetails,
		conversationId: params.conversationId,
		mcpTools: new McpTools({ mcpTools: mcpToolDefinitions }),
	});

	const initialRequest = new AgentClientMessage({
		message: { case: "runRequest", value: runRequest },
	});

	return {
		initialRequest,
		conversationState,
	};
}

export function getContextTools(context: Context): McpToolDefinition[] {
	return buildMcpToolDefinitions((context as ContextWithTools).tools);
}
