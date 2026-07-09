import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";

export async function captureStreamEvents(stream: AssistantMessageEventStream) {
	const events: unknown[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

export const collectStreamEvents = captureStreamEvents;
