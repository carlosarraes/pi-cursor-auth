import fs from "node:fs/promises";
import path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { createWriteTool } from "@mariozechner/pi-coding-agent";
import type {
	WriteArgs,
	WriteResult,
} from "../../__generated__/agent/v1/write_exec_pb";
import { CURSOR_PROVIDER_ID } from "../../lib/env";
import type { Executor } from "../../vendor/agent-exec";
import { resolvePath } from "../../vendor/local-exec";
import {
	buildErrorResult,
	createToolResultMessage,
	decodeToolCallId,
	executePiTool,
	type PiToolContext,
} from "../local-resource-provider/types";
import { buildWriteRejected, buildWriteResult } from "../protobuf-transforms";

const textDecoder = new TextDecoder();

export class LocalWriteExecutor implements Executor<WriteArgs, WriteResult> {
	private readonly writeTool;
	private readonly ctx: PiToolContext;

	constructor(ctx: PiToolContext) {
		this.ctx = ctx;
		this.writeTool = createWriteTool(ctx.cwd);
	}

	async execute(_ctx: unknown, args: WriteArgs): Promise<WriteResult> {
		const toolCallId = decodeToolCallId(args.toolCallId);

		if (!this.ctx.getActiveTools().has("write")) {
			return buildWriteRejected(args.path, "Tool not available");
		}

		const transformArgs = {
			path: args.path,
			fileText: args.fileText,
			fileBytes: args.fileBytes,
			returnFileContentAfterWrite: args.returnFileContentAfterWrite,
		};

		if (
			args.fileBytes &&
			args.fileBytes.length > 0 &&
			(!args.fileText || args.fileText.length === 0)
		) {
			const toolResult = await this.executeBinaryWrite(
				{ path: args.path, fileBytes: args.fileBytes },
				toolCallId,
			);
			return buildWriteResult(transformArgs, toolResult);
		}

		const fileText =
			args.fileText ?? textDecoder.decode(args.fileBytes ?? new Uint8Array());

		const toolResult = await executePiTool(
			this.ctx,
			this.writeTool,
			"write",
			toolCallId,
			{ path: args.path, content: fileText },
		);
		return buildWriteResult({ ...transformArgs, fileText }, toolResult);
	}

	private async executeBinaryWrite(
		writeArgs: { path: string; fileBytes: Uint8Array },
		toolCallId: string,
	) {
		const toolArgs = {
			path: writeArgs.path,
			binary: true,
			size: writeArgs.fileBytes.length,
		};

		const extCtx = this.ctx.getCtx();
		if (extCtx?.hasUI) {
			extCtx.ui.setWorkingMessage("Cursor: write (binary)");
			extCtx.ui.setStatus(CURSOR_PROVIDER_ID, `write: ${writeArgs.path}`);
		}
		this.ctx.onToolExec?.({
			type: "start",
			toolCallId,
			toolName: "write",
			args: toolArgs,
		});

		const absolutePath = resolvePath(writeArgs.path, this.ctx.cwd);
		let result: AgentToolResult<unknown>;
		let isError = false;

		try {
			await fs.mkdir(path.dirname(absolutePath), { recursive: true });
			await fs.writeFile(absolutePath, Buffer.from(writeArgs.fileBytes));
			result = {
				content: [
					{
						type: "text",
						text: `Successfully wrote ${writeArgs.fileBytes.length} bytes to ${writeArgs.path}`,
					},
				],
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
			"write",
			result,
			isError,
		);
		this.ctx.onToolExec?.({
			type: "end",
			toolCallId,
			toolName: "write",
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
