import type { Interceptor } from "@connectrpc/connect";

export interface ServiceOptions {
	accessToken: string;
	clientType: string;
	clientVersion: string;
}

export function createCursorInterceptor(options: ServiceOptions): Interceptor {
	return (next) => async (req) => {
		req.header.set("authorization", `Bearer ${options.accessToken}`);
		req.header.set("x-cursor-client-type", options.clientType);
		req.header.set("x-cursor-client-version", options.clientVersion);
		req.header.set("x-ghost-mode", "true");
		req.header.set("x-request-id", crypto.randomUUID());
		return next(req);
	};
}
