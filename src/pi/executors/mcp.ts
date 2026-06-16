import { Value } from "@bufbuild/protobuf";
import {
	McpArgs,
	McpError,
	McpResult,
	McpSuccess,
	McpTextContent,
	McpToolNotFound,
	McpToolResultContentItem,
} from "../../__generated__/agent/v1/mcp_tool_pb";
import type { Executor } from "../../vendor/agent-exec";
import { runAskUser } from "../ask-user/run";
import { createToolResultMessage, decodeToolCallId, type PiToolContext } from "../local-resource-provider/types";

const ASK_USER_TOOL = "ask_user_question";

function decodeArgValue(bytes: Uint8Array): unknown {
	try {
		return Value.fromBinary(bytes).toJson();
	} catch {
		try {
			return JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			return new TextDecoder().decode(bytes);
		}
	}
}

function decodeArgs(args: Record<string, Uint8Array>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, bytes] of Object.entries(args)) {
		out[key] = decodeArgValue(bytes);
	}
	return out;
}

function textItem(text: string): McpToolResultContentItem {
	return new McpToolResultContentItem({
		content: { case: "text", value: new McpTextContent({ text }) },
	});
}

function errorResult(message: string): McpResult {
	return new McpResult({ result: { case: "error", value: new McpError({ error: message }) } });
}

/**
 * Executes the MCP tools that pi advertises to the Cursor backend. The Cursor
 * agent loop runs tools provider-side, and pi does not expose extension tools
 * to providers for execution — so we render the dialog ourselves via ctx.ui for
 * the tools we can fully own. `ask_user_question` is bridged here; anything else
 * returns toolNotFound (a clean signal, not the old "MCP not supported" stub).
 */
export class LocalMcpExecutor implements Executor<McpArgs, McpResult> {
	constructor(private readonly ctx: PiToolContext) {}

	async execute(_ctx: unknown, args: McpArgs): Promise<McpResult> {
		const toolName = args.toolName || args.name;
		if (toolName !== ASK_USER_TOOL) {
			return new McpResult({
				result: {
					case: "toolNotFound",
					value: new McpToolNotFound({ name: toolName, availableTools: [ASK_USER_TOOL] }),
				},
			});
		}

		const extCtx = this.ctx.getCtx();
		if (!extCtx) {
			return errorResult("ask_user_question is unavailable: no active session UI context.");
		}

		const toolCallId = decodeToolCallId(args.toolCallId);
		const input = decodeArgs(args.args);
		this.ctx.onToolExec?.({ type: "start", toolCallId, toolName, args: input });

		try {
			const result = await runAskUser(extCtx, input, this.ctx.signal);
			this.ctx.onToolExec?.({
				type: "end",
				toolCallId,
				toolName,
				args: input,
				result: createToolResultMessage(toolCallId, toolName, result, false),
			});
			const content = result.content.map((item) => textItem(item.text));
			return new McpResult({ result: { case: "success", value: new McpSuccess({ content, isError: false }) } });
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}
	}
}
