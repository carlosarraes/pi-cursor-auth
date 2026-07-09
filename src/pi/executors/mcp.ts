import { Value } from "@bufbuild/protobuf";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
	type McpArgs,
	McpError,
	McpImageContent,
	McpResult,
	McpSuccess,
	McpTextContent,
	McpToolNotFound,
	McpToolResultContentItem,
} from "../../__generated__/agent/v1/mcp_tool_pb";
import type { Executor } from "../../vendor/agent-exec";
import { runAskUser } from "../ask-user/run";
import {
	createToolResultMessage,
	decodeToolCallId,
	type PiToolContext,
} from "../local-resource-provider/types";

export const ASK_USER_TOOL = "ask_user_question";

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

function imageItem(data: string, mimeType: string): McpToolResultContentItem {
	return new McpToolResultContentItem({
		content: {
			case: "image",
			value: new McpImageContent({
				data: Buffer.from(data, "base64"),
				mimeType,
			}),
		},
	});
}

function errorResult(message: string): McpResult {
	return new McpResult({
		result: { case: "error", value: new McpError({ error: message }) },
	});
}

function availableTools(ctx: PiToolContext): string[] {
	const tools = [ASK_USER_TOOL];
	for (const tool of ctx.getExecutableMcpTools?.() ?? []) {
		if (tool !== ASK_USER_TOOL) tools.push(tool);
	}
	return tools;
}

function mcpSuccessFromToolResult(result: ToolResultMessage): McpSuccess {
	const content = result.content.map((item) => {
		if (item.type === "image") {
			return imageItem(item.data, item.mimeType);
		}
		return textItem(item.text);
	});
	return new McpSuccess({ content, isError: result.isError });
}

/**
 * Executes the MCP tools that pi advertises to the Cursor backend. The Cursor
 * agent loop runs tools provider-side, and pi does not expose extension tools
 * to providers for execution — so we render the dialog ourselves via ctx.ui for
 * the tools we can fully own. `ask_user_question` is bridged here; other tools
 * run only when PiToolContext exposes an explicit MCP executor for them.
 */
export class LocalMcpExecutor implements Executor<McpArgs, McpResult> {
	constructor(private readonly ctx: PiToolContext) {}

	async execute(_ctx: unknown, args: McpArgs): Promise<McpResult> {
		const toolName = args.toolName || args.name;
		if (toolName !== ASK_USER_TOOL) {
			const executableTools = this.ctx.getExecutableMcpTools?.();
			if (this.ctx.executeMcpTool && executableTools?.has(toolName)) {
				const toolCallId = decodeToolCallId(args.toolCallId);
				const input = decodeArgs(args.args);
				try {
					const result = await this.ctx.executeMcpTool(
						toolCallId,
						toolName,
						input,
					);
					return new McpResult({
						result: {
							case: "success",
							value: mcpSuccessFromToolResult(result),
						},
					});
				} catch (error) {
					return errorResult(
						error instanceof Error ? error.message : String(error),
					);
				}
			}

			return new McpResult({
				result: {
					case: "toolNotFound",
					value: new McpToolNotFound({
						name: toolName,
						availableTools: availableTools(this.ctx),
					}),
				},
			});
		}

		const extCtx = this.ctx.getCtx();
		if (!extCtx) {
			return errorResult(
				"ask_user_question is unavailable: no active session UI context.",
			);
		}

		const toolCallId = decodeToolCallId(args.toolCallId);
		const input = decodeArgs(args.args);
		this.ctx.onToolExec?.({ type: "start", toolCallId, toolName, args: input });

		try {
			const result = await runAskUser(extCtx, input, this.ctx.signal);
			const toolResult = createToolResultMessage(
				toolCallId,
				toolName,
				result,
				false,
			);
			this.ctx.onToolExec?.({
				type: "end",
				toolCallId,
				toolName,
				args: input,
				result: toolResult,
			});
			return new McpResult({
				result: {
					case: "success",
					value: mcpSuccessFromToolResult(toolResult),
				},
			});
		} catch (error) {
			return errorResult(
				error instanceof Error ? error.message : String(error),
			);
		}
	}
}
