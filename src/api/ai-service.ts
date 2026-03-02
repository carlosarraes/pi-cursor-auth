import { type Client, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { AiService as AiServiceDef } from "../__generated__/aiserver/v1/aiserver_service_connect";
import { type ServiceOptions, createCursorInterceptor } from "./shared";

export default class AiService {
	private readonly client: Client<typeof AiServiceDef>;

	constructor(baseUrl: string, options: ServiceOptions) {
		this.client = createClient(
			AiServiceDef,
			createConnectTransport({
				baseUrl,
				httpVersion: "1.1",
				interceptors: [createCursorInterceptor(options)],
			}),
		);
	}

	async getUsableModels() {
		return this.client.getUsableModels({});
	}
}
