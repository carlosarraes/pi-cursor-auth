import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import type {
	BackgroundShellSpawnArgs,
	BackgroundShellSpawnResult,
} from "../../__generated__/agent/v1/background_shell_exec_pb";
import {
	BackgroundShellSpawnError,
	BackgroundShellSpawnResult as BackgroundShellSpawnResultClass,
	BackgroundShellSpawnSuccess,
} from "../../__generated__/agent/v1/background_shell_exec_pb";
import {
	ShellRejected,
	ShellStreamBackgrounded,
} from "../../__generated__/agent/v1/shell_exec_pb";
import type { WriteShellStdinArgs } from "../../__generated__/agent/v1/write_shell_stdin_tool_pb";
import {
	WriteShellStdinError,
	WriteShellStdinResult,
	WriteShellStdinSuccess,
} from "../../__generated__/agent/v1/write_shell_stdin_tool_pb";
import type { Executor } from "../../vendor/agent-exec";
import { resolvePath } from "../../vendor/local-exec";
import type { PiToolContext } from "../local-resource-provider/types";
import { confirmIfDangerous } from "./shell";

interface BackgroundShell {
	child: ChildProcessWithoutNullStreams;
	outputBytes: number;
}

export class BackgroundShellManager {
	private nextShellId = 1;
	private readonly shells = new Map<number, BackgroundShell>();

	async spawn(
		ctx: PiToolContext,
		args: {
			command: string;
			workingDirectory?: string;
			skipApproval?: boolean;
		},
	): Promise<
		| { ok: true; shellId: number; cwd: string; pid?: number }
		| { ok: false; reason: "rejected" | "error"; message: string; cwd: string }
	> {
		const cwd = resolvePath(args.workingDirectory || ctx.cwd, ctx.cwd);

		if (!ctx.getActiveTools().has("bash")) {
			return {
				ok: false,
				reason: "rejected",
				message: "Tool not available",
				cwd,
			};
		}

		const approved =
			args.skipApproval || (await confirmIfDangerous(ctx.getCtx, args.command));
		if (!approved) {
			return {
				ok: false,
				reason: "rejected",
				message: "Command rejected",
				cwd,
			};
		}

		try {
			await fsAccess(cwd, constants.F_OK);
		} catch {
			return {
				ok: false,
				reason: "error",
				message: `Working directory does not exist: ${cwd}`,
				cwd,
			};
		}

		try {
			const child = spawn(args.command, {
				cwd,
				detached: process.platform !== "win32",
				env: process.env,
				shell: process.env["SHELL"] || true,
				stdio: "pipe",
				windowsHide: true,
			});
			const shellId = this.nextShellId++;
			const state: BackgroundShell = { child, outputBytes: 0 };
			this.shells.set(shellId, state);

			const recordOutput = (chunk: Buffer) => {
				state.outputBytes += chunk.byteLength;
			};
			child.stdout.on("data", recordOutput);
			child.stderr.on("data", recordOutput);
			child.once("close", () => {
				this.shells.delete(shellId);
			});

			return {
				ok: true,
				shellId,
				cwd,
				...(child.pid ? { pid: child.pid } : {}),
			};
		} catch (error) {
			return {
				ok: false,
				reason: "error",
				message: error instanceof Error ? error.message : String(error),
				cwd,
			};
		}
	}

	write(shellId: number, chars: string): WriteShellStdinResult {
		const shell = this.shells.get(shellId);
		if (!shell) {
			return new WriteShellStdinResult({
				result: {
					case: "error",
					value: new WriteShellStdinError({
						error: `Background shell ${shellId} is not running`,
					}),
				},
			});
		}

		const before = shell.outputBytes;
		shell.child.stdin.write(chars);
		return new WriteShellStdinResult({
			result: {
				case: "success",
				value: new WriteShellStdinSuccess({
					shellId,
					terminalFileLengthBeforeInputWritten: before,
				}),
			},
		});
	}
}

export class LocalBackgroundShellExecutor
	implements Executor<BackgroundShellSpawnArgs, BackgroundShellSpawnResult>
{
	constructor(
		private readonly ctx: PiToolContext,
		private readonly manager: BackgroundShellManager,
	) {}

	async execute(
		_ctx: unknown,
		args: BackgroundShellSpawnArgs,
	): Promise<BackgroundShellSpawnResult> {
		const result = await this.manager.spawn(this.ctx, {
			command: args.command,
			workingDirectory: args.workingDirectory,
		});

		if (result.ok) {
			return new BackgroundShellSpawnResultClass({
				result: {
					case: "success",
					value: new BackgroundShellSpawnSuccess({
						shellId: result.shellId,
						command: args.command,
						workingDirectory: result.cwd,
						...(result.pid ? { pid: result.pid } : {}),
					}),
				},
			});
		}

		if (result.reason === "rejected") {
			return new BackgroundShellSpawnResultClass({
				result: {
					case: "rejected",
					value: new ShellRejected({
						command: args.command,
						workingDirectory: result.cwd,
						reason: result.message,
						isReadonly: false,
					}),
				},
			});
		}

		return new BackgroundShellSpawnResultClass({
			result: {
				case: "error",
				value: new BackgroundShellSpawnError({
					command: args.command,
					workingDirectory: result.cwd,
					error: result.message,
				}),
			},
		});
	}
}

export class LocalWriteShellStdinExecutor
	implements Executor<WriteShellStdinArgs, WriteShellStdinResult>
{
	constructor(private readonly manager: BackgroundShellManager) {}

	async execute(
		_ctx: unknown,
		args: WriteShellStdinArgs,
	): Promise<WriteShellStdinResult> {
		return this.manager.write(args.shellId, args.chars);
	}
}

export async function spawnBackgroundShellStream(
	ctx: PiToolContext,
	manager: BackgroundShellManager,
	args: { command: string; workingDirectory?: string; skipApproval?: boolean },
): Promise<
	| { ok: true; event: ShellStreamBackgrounded }
	| { ok: false; reason: "rejected" | "error"; message: string; cwd: string }
> {
	const result = await manager.spawn(ctx, args);
	if (!result.ok) return result;
	return {
		ok: true,
		event: new ShellStreamBackgrounded({
			shellId: result.shellId,
			command: args.command,
			workingDirectory: result.cwd,
			...(result.pid ? { pid: result.pid } : {}),
		}),
	};
}
