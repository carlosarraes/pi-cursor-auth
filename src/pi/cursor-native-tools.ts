export const CURSOR_NATIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
	"bash",
	"read",
	"write",
	"delete",
	"ls",
	"grep",
	"lsp",
	"todo",
]);

export function isCursorNativeTool(name: string): boolean {
	return CURSOR_NATIVE_TOOL_NAMES.has(name);
}
