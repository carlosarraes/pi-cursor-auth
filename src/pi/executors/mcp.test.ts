import assert from "node:assert/strict";
import test from "node:test";
import { McpArgs } from "../../__generated__/agent/v1/mcp_tool_pb";
import type { PiToolContext } from "../local-resource-provider/types";
import { LocalMcpExecutor } from "./mcp";

function createCtx(overrides: Partial<PiToolContext> = {}): PiToolContext {
	return {
		cwd: "/tmp",
		getActiveTools: () => new Set(["ask_user_question"]),
		getCtx: () => null,
		...overrides,
	};
}

test("unsupported MCP tool reports only executable bridge tools as available", async () => {
	const executor = new LocalMcpExecutor(
		createCtx({
			getActiveTools: () =>
				new Set(["ask_user_question", "todo_write", "custom_bridge"]),
			getExecutableMcpTools: () => new Set(["custom_bridge"]),
		}),
	);

	const result = await executor.execute(
		null,
		new McpArgs({ toolName: "todo_write" }),
	);

	assert.equal(result.result.case, "toolNotFound");
	assert.deepEqual(result.result.value.availableTools, [
		"ask_user_question",
		"custom_bridge",
	]);
});

test("supported custom MCP tool executes through PiToolContext bridge", async () => {
	const executor = new LocalMcpExecutor(
		createCtx({
			getExecutableMcpTools: () => new Set(["custom_bridge"]),
			executeMcpTool: async (toolCallId, toolName, args) => ({
				role: "toolResult",
				toolCallId,
				toolName,
				content: [{ type: "text", text: `ran ${args["value"]}` }],
				isError: false,
				timestamp: 123,
			}),
		}),
	);

	const result = await executor.execute(
		null,
		new McpArgs({
			name: "custom_bridge",
			toolCallId: "call-1",
			args: { value: new TextEncoder().encode(JSON.stringify("ok")) },
		}),
	);

	assert.equal(result.result.case, "success");
	const [content] = result.result.value.content;
	assert.equal(content?.content.case, "text");
	assert.equal(content.content.value.text, "ran ok");
	assert.equal(result.result.value.isError, false);
});
