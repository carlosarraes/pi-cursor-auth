import assert from "node:assert/strict";
import test from "node:test";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import {
	appendCursorMcpArgsSnapshot,
	completeCursorMcpToolCall,
	createCursorStreamState,
	startCursorMcpToolCall,
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

test("appendCursorMcpArgsSnapshot emits only cumulative argument suffixes", () => {
	const message = output();
	const stream = createAssistantMessageEventStream();
	const events: unknown[] = [];
	const originalPush = stream.push.bind(stream);
	stream.push = (event) => {
		events.push(event);
		originalPush(event);
	};

	const state = createCursorStreamState(message, stream);
	startCursorMcpToolCall(state, "call-plan", "update_plan");

	const finalSnapshot =
		'{"tasks":[{"id":"1","content":"Inspect stream handling","status":"completed"},{"id":"2","content":"Preserve cumulative args","status":"in_progress"}]}';
	const snapshots = [
		'{"tasks":[',
		'{"tasks":[{"id":"1","content":"Inspect stream handling"',
		'{"tasks":[{"id":"1","content":"Inspect stream handling","status":"completed"}',
		finalSnapshot,
	];

	for (const snapshot of snapshots) {
		appendCursorMcpArgsSnapshot(state, snapshot);
	}

	const deltas = events
		.filter((event) => (event as { type: string }).type === "toolcall_delta")
		.map((event) => (event as { delta: string }).delta);

	assert.equal(deltas.join(""), finalSnapshot);
	assert.equal(deltas.length, snapshots.length);
});

test("completeCursorMcpToolCall merges completion args without dropping streamed keys", () => {
	const message = output();
	const stream = createAssistantMessageEventStream();
	const events: unknown[] = [];
	const originalPush = stream.push.bind(stream);
	stream.push = (event) => {
		events.push(event);
		originalPush(event);
	};

	const state = createCursorStreamState(message, stream);
	startCursorMcpToolCall(state, "call-edit", "edit_file");
	appendCursorMcpArgsSnapshot(
		state,
		JSON.stringify({
			path: "src/app.ts",
			largeReplacement: "x".repeat(2048),
			instruction: "streamed value",
		}),
	);

	completeCursorMcpToolCall(state, {
		path: "src/app.ts",
		instruction: "decoded completion value",
	});

	assert.deepEqual(message.content, [
		{
			type: "toolCall",
			id: "call-edit",
			name: "edit_file",
			arguments: {
				path: "src/app.ts",
				largeReplacement: "x".repeat(2048),
				instruction: "decoded completion value",
			},
		},
	]);
	assert.deepEqual(
		events.map((event) => (event as { type: string }).type),
		["toolcall_start", "toolcall_delta", "toolcall_end"],
	);
});

test("completeCursorMcpToolCall keeps streamed structured args when completion falls back to a raw string", () => {
	const message = output();
	const stream = createAssistantMessageEventStream();
	const state = createCursorStreamState(message, stream);
	startCursorMcpToolCall(state, "call-task", "task");
	appendCursorMcpArgsSnapshot(
		state,
		JSON.stringify({
			tasks: [{ assignment: "do A" }, { assignment: "do B" }],
			context: "streamed context",
		}),
	);

	completeCursorMcpToolCall(state, {
		tasks: "[{assignment: 'do A'}]",
		context: "decoded context",
	});

	assert.deepEqual(message.content[0], {
		type: "toolCall",
		id: "call-task",
		name: "task",
		arguments: {
			tasks: [{ assignment: "do A" }, { assignment: "do B" }],
			context: "decoded context",
		},
	});
});
