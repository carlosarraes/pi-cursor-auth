import assert from "node:assert/strict";
import test from "node:test";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import {
	createCursorStreamState,
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

test("synthesizeCursorExecToolCall emits structured toolcall events", () => {
	const message = output();
	const stream = createAssistantMessageEventStream();
	const events: unknown[] = [];
	const originalPush = stream.push.bind(stream);
	stream.push = (event) => {
		events.push(event);
		originalPush(event);
	};

	const state = createCursorStreamState(message, stream);
	synthesizeCursorExecToolCall(state, "call-read", "read", {
		path: "package.json",
	});

	assert.deepEqual(message.content, [
		{
			type: "toolCall",
			id: "call-read",
			name: "read",
			arguments: { path: "package.json" },
		},
	]);
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		["toolcall_start", "toolcall_end"],
	);
});
