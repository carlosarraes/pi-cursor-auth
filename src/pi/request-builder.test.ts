import assert from "node:assert/strict";
import test from "node:test";
import { getContextTools } from "./request-builder";

const parameters = { type: "object", properties: {}, required: [] } as const;

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
