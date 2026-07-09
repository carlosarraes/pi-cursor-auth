import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL } from "./pi/executors/mcp";
import { getExecutableCursorMcpTools } from "./stream";

test("ask_user_question is advertised only when interactive UI is available", () => {
	assert.deepEqual(
		getExecutableCursorMcpTools(() => null),
		new Set(),
	);
	assert.deepEqual(
		getExecutableCursorMcpTools(
			() => ({ hasUI: false }) as unknown as ExtensionContext,
		),
		new Set(),
	);
	assert.deepEqual(
		getExecutableCursorMcpTools(
			() => ({ hasUI: true }) as unknown as ExtensionContext,
		),
		new Set([ASK_USER_TOOL]),
	);
});
