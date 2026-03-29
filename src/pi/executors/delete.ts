import fs from "node:fs/promises";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type {
	DeleteArgs,
	DeleteResult,
} from "../../__generated__/agent/v1/delete_exec_pb";
import { CURSOR_PROVIDER_ID } from "../../lib/env";
import type { Executor } from "../../vendor/agent-exec";
import { resolvePath } from "../../vendor/local-exec";
import {
	buildErrorResult,
	createToolResultMessage,
	decodeToolCallId,
	type PiToolContext,
} from "../local-resource-provider/types";
import { buildDeleteRejected, buildDeleteResult } from "../protobuf-transforms";

export class LocalDeleteExecutor implements Executor<DeleteArgs, DeleteResult> {
	private readonly ctx: PiToolContext;

	constructor(ctx: PiToolContext) {
		this.ctx = ctx;
	}

	async execute(_ctx: unknown, args: DeleteArgs): Promise<DeleteResult> {
		const toolCallId = decodeToolCallId(args.toolCallId);

		if (!this.ctx.getActiveTools().has("delete")) {
			return buildDeleteRejected(args.path, "Tool not available");
		}

		const toolResult = await this.executeDelete(args.path, toolCallId);
		return buildDeleteResult(args.path, toolResult);
	}

	private async executeDelete(pathArg: string, toolCallId: string) {
		const toolArgs = { path: pathArg };

		const extCtx = this.ctx.getCtx();
		if (extCtx?.hasUI) {
			extCtx.ui.setWorkingMessage("Cursor: delete");
			extCtx.ui.setStatus(CURSOR_PROVIDER_ID, `delete: ${pathArg}`);
		}
		this.ctx.onToolExec?.({
			type: "start",
			toolCallId,
			toolName: "delete",
			args: toolArgs,
		});

		const absolutePath = resolvePath(pathArg, this.ctx.cwd);
		let result: AgentToolResult<unknown>;
		let isError = false;

		try {
			const stat = await fs.stat(absolutePath);
			if (!stat.isFile()) {
				throw new Error(`Path is not a file: ${pathArg}`);
			}
			await fs.rm(absolutePath);
			const sizeText = stat.size ? ` (${stat.size} bytes)` : "";
			result = {
				content: [{ type: "text", text: `Deleted ${pathArg}${sizeText}` }],
				details: undefined,
			};
		} catch (error) {
			isError = true;
			result = buildErrorResult(
				error instanceof Error ? error.message : String(error),
			);
		}

		const toolResult = createToolResultMessage(
			toolCallId,
			"delete",
			result,
			isError,
		);
		this.ctx.onToolExec?.({
			type: "end",
			toolCallId,
			toolName: "delete",
			args: toolArgs,
			result: toolResult,
		});

		if (extCtx?.hasUI) {
			extCtx.ui.setWorkingMessage();
			extCtx.ui.setStatus(CURSOR_PROVIDER_ID, undefined);
		}

		return toolResult;
	}
}
