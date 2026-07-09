import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@bufbuild/protobuf";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import {
	InteractionUpdate,
	PartialToolCallUpdate,
	ToolCall,
} from "../__generated__/agent/v1/agent_pb";
import { McpArgs, McpToolCall } from "../__generated__/agent/v1/mcp_tool_pb";
import {
	type CoreInteractionUpdate,
	convertProtoToInteractionUpdate,
} from "../vendor/agent-core";
import { processCursorInteractionUpdate } from "./cursor-interaction-updates";
import {
	createCursorStreamState,
	finalizeCursorProviderToolCalls,
	synthesizeCursorExecToolCall,
} from "./cursor-stream-state";

function output(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "cursor-agent" as never,
		provider: "cursor-agent" as never,
		model: "cursor-composer-2.5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

function mcpToolCall(
	toolCallId: string,
	toolName: string,
	args: Record<string, Uint8Array> = {},
): ToolCall {
	return new ToolCall({
		tool: {
			case: "mcpToolCall",
			value: new McpToolCall({
				args: new McpArgs({ toolCallId, toolName, args }),
			}),
		},
	});
}

function update(
	type: "tool-call-started" | "partial-tool-call" | "tool-call-completed",
	toolCall: ToolCall,
	argsTextDelta?: string,
): CoreInteractionUpdate {
	return {
		type,
		callId: "interaction-call",
		toolCall,
		modelCallId: "model-call",
		...(argsTextDelta === undefined ? {} : { argsTextDelta }),
	} as CoreInteractionUpdate;
}

test("interaction conversion exposes partial MCP argsTextDelta", () => {
	const converted = convertProtoToInteractionUpdate(
		new InteractionUpdate({
			message: {
				case: "partialToolCall",
				value: new PartialToolCallUpdate({
					callId: "interaction-call",
					modelCallId: "model-call",
					toolCall: mcpToolCall("mcp-1", "update_plan"),
					argsTextDelta: '{"tasks":[',
				}),
			},
		}),
	);

	assert.equal(converted?.type, "partial-tool-call");
	assert.equal(
		(converted as Extract<CoreInteractionUpdate, { type: "partial-tool-call" }>)
			.argsTextDelta,
		'{"tasks":[',
	);
});

function assertProviderCallLifecycle(
	ordering: "interaction-first" | "exec-first",
): void {
	const message = output();
	const stream = createAssistantMessageEventStream();
	const events: Array<{ type: string; delta?: string }> = [];
	const originalPush = stream.push.bind(stream);
	stream.push = (event) => {
		events.push(event);
		originalPush(event);
	};
	const state = createCursorStreamState(message, stream);
	const id = `mcp-${ordering}`;
	const start = () =>
		processCursorInteractionUpdate(
			state,
			update("tool-call-started", mcpToolCall(id, "update_plan")),
		);
	const exec = () =>
		synthesizeCursorExecToolCall(state, id, "update_plan", {
			tasks: [{ id: "exec", status: "pending" }],
		});

	if (ordering === "interaction-first") {
		start();
		exec();
	} else {
		exec();
		start();
	}

	processCursorInteractionUpdate(
		state,
		update("partial-tool-call", mcpToolCall(id, "update_plan"), '{"tasks":['),
	);
	const finalSnapshot =
		'{"tasks":[{"id":"1","status":"in_progress"}],"note":"streamed","metadata":{"source":"partial"}}';
	processCursorInteractionUpdate(
		state,
		update("partial-tool-call", mcpToolCall(id, "update_plan"), finalSnapshot),
	);
	processCursorInteractionUpdate(
		state,
		update(
			"tool-call-completed",
			mcpToolCall(id, "update_plan", {
				tasks: Value.fromJson([{ id: "1", status: "completed" }]).toBinary(),
			}),
		),
	);

	assert.deepEqual(
		events.map((event) => event.type),
		["toolcall_start", "toolcall_delta", "toolcall_delta", "toolcall_end"],
	);
	assert.equal(
		events
			.filter((event) => event.type === "toolcall_delta")
			.map((event) => event.delta)
			.join(""),
		finalSnapshot,
	);
	assert.deepEqual(message.content[0], {
		type: "toolCall",
		id,
		name: "update_plan",
		arguments: {
			tasks: [{ id: "1", status: "completed" }],
			note: "streamed",
			metadata: { source: "partial" },
		},
	});

	finalizeCursorProviderToolCalls(state);

	assert.equal(
		events.filter((event) => event.type === "toolcall_start").length,
		1,
	);
	assert.equal(
		events.filter((event) => event.type === "toolcall_end").length,
		1,
	);
	assert.equal(
		message.content.some((block) => block.type === "toolCall"),
		false,
	);
}

test("interaction-first provider calls keep one lifecycle and deduplicate the exec callback", () => {
	assertProviderCallLifecycle("interaction-first");
});

test("exec-first provider calls attach later interaction updates to the existing block", () => {
	assertProviderCallLifecycle("exec-first");
});
