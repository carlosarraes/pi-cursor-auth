import type {
	ImageContent,
	TextContent,
	ToolResultMessage,
} from "@mariozechner/pi-ai";

export function toolResultToText(result: ToolResultMessage): string {
	return result.content
		.map((item: TextContent | ImageContent) =>
			item.type === "text" ? item.text : `[${item.mimeType} image]`,
		)
		.join("\n");
}

export function toolResultWasTruncated(result: ToolResultMessage): boolean {
	if (!result.details || typeof result.details !== "object") {
		return false;
	}
	const truncation = (
		result.details as { truncation?: { truncated?: boolean } }
	).truncation;
	return !!truncation?.truncated;
}

export function toolResultDetailBoolean(
	result: ToolResultMessage,
	key: string,
): boolean {
	if (!result.details || typeof result.details !== "object") {
		return false;
	}
	const value = (result.details as Record<string, unknown>)[key];
	return typeof value === "boolean" ? value : false;
}
