import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { Executor } from "../../vendor/agent-exec";
import {
	decodeToolCallId,
	executeWithContext,
	type PiToolContext,
} from "../local-resource-provider/types";

interface ExecutableTool {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<AgentToolResult<unknown>>;
}

// biome-ignore lint/suspicious/noExplicitAny: tool factories return varied types
type ToolFactory = (cwd: string) => any;

/**
 * Generic executor for simple tools (read, ls, grep) that follow the pattern:
 * check availability → execute Pi tool → transform result to protobuf.
 */
export class GenericToolExecutor<TArgs extends { toolCallId?: string }, TResult>
	implements Executor<TArgs, TResult>
{
	private readonly tool: ExecutableTool;
	private readonly ctx: PiToolContext;
	private readonly toolName: string;
	private readonly extractArgs: (args: TArgs) => Record<string, unknown>;
	private readonly transform: (
		args: TArgs,
		result: ToolResultMessage,
	) => TResult;
	private readonly buildRejected: (args: TArgs) => TResult;

	constructor(opts: {
		ctx: PiToolContext;
		toolName: string;
		toolFactory: ToolFactory;
		extractArgs: (args: TArgs) => Record<string, unknown>;
		transform: (args: TArgs, result: ToolResultMessage) => TResult;
		buildRejected: (args: TArgs) => TResult;
	}) {
		this.ctx = opts.ctx;
		this.toolName = opts.toolName;
		this.tool = opts.toolFactory(opts.ctx.cwd) as ExecutableTool;
		this.extractArgs = opts.extractArgs;
		this.transform = opts.transform;
		this.buildRejected = opts.buildRejected;
	}

	async execute(_ctx: unknown, args: TArgs): Promise<TResult> {
		const toolCallId = decodeToolCallId(args.toolCallId);
		const toolArgs = this.extractArgs(args);
		return executeWithContext(
			this.ctx,
			this.tool,
			this.toolName,
			toolCallId,
			toolArgs,
			(result) => this.transform(args, result),
			() => this.buildRejected(args),
		);
	}
}
