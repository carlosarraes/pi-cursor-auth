/**
 * Rewrites provider error messages to convert relative-time hints
 * (e.g. "Try again in ~342 min.") into absolute clock times that
 * are easier for users to act on.
 *
 * Hooked from `message_end` in src/index.ts. Applies to any provider's
 * errorMessage that flows through pi-mono's extension event bus.
 */

const RELATIVE_TIME_PATTERN = /Try again in ~(\d+)\s*min\b\.?/i;

export function rewriteRelativeTimeInError(
	errorMessage: string,
	now: Date = new Date(),
): string {
	const match = errorMessage.match(RELATIVE_TIME_PATTERN);
	if (!match) return errorMessage;

	const minutes = Number.parseInt(match[1] ?? "", 10);
	if (!Number.isFinite(minutes) || minutes < 0) return errorMessage;

	const replacement = formatRetryHint(minutes, now);
	if (!replacement) return errorMessage;

	return errorMessage.replace(match[0], replacement);
}

function formatRetryHint(minutes: number, now: Date): string {
	if (minutes < 60) return `Try again in ~${minutes} min.`;
	const reset = new Date(now.getTime() + minutes * 60_000);
	const time = reset.toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
	const isTomorrow = reset.toDateString() !== now.toDateString();
	return isTomorrow
		? `Try again at ${time} tomorrow.`
		: `Try again at ${time}.`;
}
