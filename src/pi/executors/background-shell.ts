import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { constants } from "node:fs";
import { appendFile, access as fsAccess, writeFile } from "node:fs/promises";
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
import {
	ensureTerminalsFolder,
	getShellLogPath,
	getTerminalIndexPath,
} from "../terminal-output";

interface BackgroundShell {
	child: ChildProcessWithoutNullStreams;
	outputBytes: number;
	logPath: string;
	logWrite: Promise<void>;
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
			args.skipApproval || (await this.confirmIfDangerous(ctx, args.command));
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
			await ensureTerminalsFolder();
			const shellId = this.nextShellId++;
			const logPath = getShellLogPath(shellId);
			const header = [
				`[shell ${shellId}] command: ${args.command}`,
				`[shell ${shellId}] cwd: ${cwd}`,
				`[shell ${shellId}] started: ${new Date().toISOString()}`,
				"",
			].join("\n");
			await writeFile(logPath, header);

			const child = spawn(args.command, {
				cwd,
				detached: process.platform !== "win32",
				env: process.env,
				shell: process.env["SHELL"] || true,
				stdio: "pipe",
				windowsHide: true,
			});
			const state: BackgroundShell = {
				child,
				outputBytes: Buffer.byteLength(header),
				logPath,
				logWrite: Promise.resolve(),
			};
			this.shells.set(shellId, state);

			const appendToLog = (content: Buffer | string) => {
				state.outputBytes += Buffer.byteLength(content);
				state.logWrite = state.logWrite
					.then(() => appendFile(state.logPath, content))
					.catch(() => undefined);
			};

			const recordOutput = (chunk: Buffer) => {
				appendToLog(chunk);
			};
			child.stdout.on("data", recordOutput);
			child.stderr.on("data", recordOutput);

			if (child.pid) {
				appendToLog(`[shell ${shellId}] pid: ${child.pid}\n`);
			}
			const indexLine = [
				`${new Date().toISOString()} shell=${shellId}`,
				child.pid ? `pid=${child.pid}` : undefined,
				`cwd=${JSON.stringify(cwd)}`,
				`log=${JSON.stringify(logPath)}`,
				`command=${JSON.stringify(args.command)}`,
			]
				.filter((part): part is string => part !== undefined)
				.join(" ");
			void appendFile(getTerminalIndexPath(), `${indexLine}\n`).catch(
				() => undefined,
			);

			child.once("close", (code, signal) => {
				appendToLog(
					[
						"",
						`[shell ${shellId}] exited: ${new Date().toISOString()}`,
						`[shell ${shellId}] exit_code: ${code ?? ""}`,
						`[shell ${shellId}] signal: ${signal ?? ""}`,
						"",
					].join("\n"),
				);
				void state.logWrite.finally(() => {
					this.shells.delete(shellId);
				});
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

	private async confirmIfDangerous(
		ctx: PiToolContext,
		command: string,
	): Promise<boolean> {
		const { confirmIfDangerous } = await import("./shell");
		return confirmIfDangerous(ctx.getCtx, command);
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
