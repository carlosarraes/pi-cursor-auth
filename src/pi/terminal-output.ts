import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TERMINALS_FOLDER = path.join(os.tmpdir(), "pi-cursor-auth", "terminals");

export function getTerminalsFolder(): string {
	return TERMINALS_FOLDER;
}

export async function ensureTerminalsFolder(): Promise<string> {
	await fs.mkdir(TERMINALS_FOLDER, { recursive: true });
	return TERMINALS_FOLDER;
}

export function getShellLogPath(shellId: number): string {
	return path.join(TERMINALS_FOLDER, `shell-${shellId}.log`);
}

export function getTerminalIndexPath(): string {
	return path.join(TERMINALS_FOLDER, "index.txt");
}
