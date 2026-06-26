import type { TextContent } from "@earendil-works/pi-ai";
import type {
	ShellArgs,
	ShellStream,
} from "../../__generated__/agent/v1/shell_exec_pb";
import {
	ShellRejected,
	ShellStream as ShellStreamClass,
	ShellStreamExit,
	ShellStreamStart,
	ShellStreamStderr,
	ShellStreamStdout,
	TimeoutBehavior,
} from "../../__generated__/agent/v1/shell_exec_pb";
import type { StreamExecutor } from "../../vendor/agent-exec";
import {
	decodeToolCallId,
	executePiTool,
	type PiToolContext,
} from "../local-resource-provider/types";
import {
	type BackgroundShellManager,
	spawnBackgroundShellStream,
} from "./background-shell";
import { confirmIfDangerous, type LocalShellExecutor } from "./shell";

export class LocalShellStreamExecutor
	implements StreamExecutor<ShellArgs, ShellStream>
{
	private readonly ctx: PiToolContext;
	private readonly shellExecutor: LocalShellExecutor;
	private readonly backgroundShellManager: BackgroundShellManager;

	constructor(
		ctx: PiToolContext,
		shellExecutor: LocalShellExecutor,
		backgroundShellManager: BackgroundShellManager,
	) {
		this.ctx = ctx;
		this.shellExecutor = shellExecutor;
		this.backgroundShellManager = backgroundShellManager;
	}

	execute(_ctx: unknown, args: ShellArgs): AsyncIterable<ShellStream> {
		return this.run(args);
	}

	private async *run(args: ShellArgs): AsyncIterable<ShellStream> {
		const toolCallId = decodeToolCallId(args.toolCallId);
		const cwd = args.workingDirectory || this.ctx.cwd;

		if (!this.ctx.getActiveTools().has("bash")) {
			yield new ShellStreamClass({
				event: {
					case: "rejected",
					value: new ShellRejected({
						command: args.command,
						workingDirectory: args.workingDirectory,
						reason: "Tool not available",
						isReadonly: false,
					}),
				},
			});
			yield new ShellStreamClass({
				event: {
					case: "exit",
					value: new ShellStreamExit({ code: 1, cwd, aborted: false }),
				},
			});
			return;
		}

		const approved = await confirmIfDangerous(this.ctx.getCtx, args.command);
		if (!approved) {
			yield new ShellStreamClass({
				event: {
					case: "rejected",
					value: new ShellRejected({
						command: args.command,
						workingDirectory: args.workingDirectory,
						reason: "Command rejected",
						isReadonly: false,
					}),
				},
			});
			yield new ShellStreamClass({
				event: {
					case: "exit",
					value: new ShellStreamExit({ code: 1, cwd, aborted: false }),
				},
			});
			return;
		}

		yield new ShellStreamClass({
			event: { case: "start", value: new ShellStreamStart({}) },
		});

		if (
			args.isBackground ||
			args.timeoutBehavior === TimeoutBehavior.BACKGROUND
		) {
			const background = await spawnBackgroundShellStream(
				this.ctx,
				this.backgroundShellManager,
				{
					command: args.command,
					workingDirectory: args.workingDirectory,
					skipApproval: true,
				},
			);

			if (background.ok) {
				yield new ShellStreamClass({
					event: { case: "backgrounded", value: background.event },
				});
			} else if (background.reason === "rejected") {
				yield new ShellStreamClass({
					event: {
						case: "rejected",
						value: new ShellRejected({
							command: args.command,
							workingDirectory: background.cwd,
							reason: background.message,
							isReadonly: false,
						}),
					},
				});
				yield new ShellStreamClass({
					event: {
						case: "exit",
						value: new ShellStreamExit({
							code: 1,
							cwd: background.cwd,
							aborted: false,
						}),
					},
				});
			} else {
				yield new ShellStreamClass({
					event: {
						case: "stderr",
						value: new ShellStreamStderr({ data: background.message }),
					},
				});
				yield new ShellStreamClass({
					event: {
						case: "exit",
						value: new ShellStreamExit({
							code: 1,
							cwd: background.cwd,
							aborted: false,
						}),
					},
				});
			}
			return;
		}

		const timeoutSeconds =
			args.timeout && args.timeout > 0 ? args.timeout : undefined;
		const bashTool = this.shellExecutor.getBashTool(
			args.workingDirectory || undefined,
		);

		const toolResult = await executePiTool(
			this.ctx,
			bashTool,
			"bash",
			toolCallId,
			{
				command: args.command,
				...(timeoutSeconds != null ? { timeout: timeoutSeconds } : {}),
			},
		);

		const text = toolResult.content
			.filter((c): c is TextContent => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		if (toolResult.isError) {
			yield new ShellStreamClass({
				event: {
					case: "stderr",
					value: new ShellStreamStderr({ data: text || "Shell failed" }),
				},
			});
			yield new ShellStreamClass({
				event: {
					case: "exit",
					value: new ShellStreamExit({ code: 1, cwd, aborted: false }),
				},
			});
			return;
		}

		if (text) {
			yield new ShellStreamClass({
				event: {
					case: "stdout",
					value: new ShellStreamStdout({ data: text }),
				},
			});
		}

		yield new ShellStreamClass({
			event: {
				case: "exit",
				value: new ShellStreamExit({ code: 0, cwd, aborted: false }),
			},
		});
	}
}
