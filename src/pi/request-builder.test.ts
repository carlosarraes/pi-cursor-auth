import assert from "node:assert/strict";
import test from "node:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import {
	type AgentClientMessage,
	type AgentRunRequest,
	ConversationStep,
	ConversationTurnStructure,
} from "../__generated__/agent/v1/agent_pb";
import { InMemoryBlobStore } from "../vendor/agent-kv";
import { buildRunRequest, getContextTools } from "./request-builder";

const parameters = { type: "object", properties: {}, required: [] } as const;

const model: Model<Api> = {
	id: "cursor-test-model",
	name: "Cursor Test Model",
	api: "cursor-agent",
	provider: "cursor",
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 8_192,
};

function buildTestRunRequest(context: Context) {
	const blobStore = new InMemoryBlobStore();
	const result = buildRunRequest({
		model,
		context,
		conversationId: "test-conversation",
		blobStore,
		conversationState: undefined,
	});
	return { ...result, blobStore };
}

function getRunRequest(message: AgentClientMessage): AgentRunRequest {
	if (message.message.case !== "runRequest") {
		assert.fail(`expected runRequest, got ${message.message.case ?? "none"}`);
	}
	return message.message.value;
}

function getStoredBlob(
	blobStore: InMemoryBlobStore,
	blobId: Uint8Array,
): Uint8Array {
	const blob = blobStore.store.get(Buffer.from(blobId).toString("hex"));
	assert.ok(blob, "expected blob to be stored");
	return blob;
}

function getSerializedStepTexts(
	blobStore: InMemoryBlobStore,
	turnIds: Uint8Array[],
): string[] {
	const texts: string[] = [];
	for (const turnId of turnIds) {
		const turn = ConversationTurnStructure.fromBinary(
			getStoredBlob(blobStore, turnId),
		);
		if (turn.turn.case !== "agentConversationTurn") continue;
		for (const stepId of turn.turn.value.steps) {
			const step = ConversationStep.fromBinary(
				getStoredBlob(blobStore, stepId),
			);
			if (step.message.case === "assistantMessage") {
				texts.push(step.message.value.text);
			}
		}
	}
	return texts;
}

test("getContextTools does not advertise Cursor native tools as MCP", () => {
	const tools = getContextTools({
		messages: [{ role: "user", content: "hi", timestamp: 0 }],
		tools: [
			{ name: "bash", description: "shell", parameters },
			{ name: "read", description: "read", parameters },
			{ name: "todo", description: "todo", parameters },
			{ name: "ask_user_question", description: "ask", parameters },
		],
	});

	assert.deepEqual(
		tools.map((tool) => tool.name),
		["ask_user_question"],
	);
});

test("todo_write is not treated as the Cursor native todo tool", () => {
	const tools = getContextTools({
		messages: [{ role: "user", content: "hi", timestamp: 0 }],
		tools: [{ name: "todo_write", description: "legacy pi tool", parameters }],
	});

	assert.deepEqual(
		tools.map((tool) => tool.name),
		["todo_write"],
	);
});

test("buildRunRequest resumes when the latest message is a tool result", () => {
	const { initialRequest } = buildTestRunRequest({
		messages: [
			{ role: "user", content: "Run the command", timestamp: 0 },
			{
				role: "toolResult",
				toolCallId: "tool-call-1",
				toolName: "bash",
				content: [{ type: "text", text: "command output" }],
				isError: false,
				timestamp: 1,
			},
		],
	});

	const runRequest = getRunRequest(initialRequest);
	assert.equal(runRequest.action?.action.case, "resumeAction");
});

test("buildRunRequest serializes errored tool results with Tool Error prefix", () => {
	const { blobStore, conversationState } = buildTestRunRequest({
		messages: [
			{ role: "user", content: "Run the command", timestamp: 0 },
			{
				role: "assistant",
				content: [{ type: "text", text: "Running it now." }],
				api: "cursor-agent",
				provider: "cursor",
				model: "cursor-test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						total: 0,
					},
				},
				stopReason: "toolUse",
				timestamp: 1,
			},
			{
				role: "toolResult",
				toolCallId: "tool-call-1",
				toolName: "bash",
				content: [{ type: "text", text: "permission denied" }],
				isError: true,
				timestamp: 2,
			},
		],
	});

	assert.ok(
		getSerializedStepTexts(blobStore, conversationState.turns).includes(
			"[Tool Error]\npermission denied",
		),
	);
});
