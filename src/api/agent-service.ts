import { type Client, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import type {
	AgentClientMessage,
	AgentServerMessage,
} from "../__generated__/agent/v1/agent_pb";
import { AgentService as AgentServiceDef } from "../__generated__/agent/v1/agent_service_connect";
import type { AgentRpcClient } from "../vendor/agent-client";
import { type ServiceOptions, createCursorInterceptor } from "./shared";

export default class AgentService {
	private readonly client: Client<typeof AgentServiceDef>;

	constructor(baseUrl: string, options: ServiceOptions) {
		this.client = createClient(
			AgentServiceDef,
			createConnectTransport({
				baseUrl,
				httpVersion: "2",
				interceptors: [createCursorInterceptor(options)],
			}),
		);
	}

	get rpcClient(): AgentRpcClient {
		const client = this.client;
		return {
			run(
				input: AsyncIterable<AgentClientMessage>,
				options?: { signal?: AbortSignal; headers?: Record<string, string> },
			): AsyncIterable<AgentServerMessage> {
				return client.run(input, options);
			},
		};
	}
}
