export class FetchError extends Error {
	constructor(
		readonly status: number,
		readonly url: string,
		body: string,
	) {
		super(`Fetch failed ${url} for ${status}: ${body}`);
	}
}

interface AuthResult {
	accessToken: string;
	refreshToken: string;
}

export default class Auth {
	constructor(private readonly baseUrl: string) {}

	async poll({
		uuid,
		verifier,
		signal,
	}: {
		uuid: string;
		verifier: string;
		signal?: AbortSignal | undefined;
	}) {
		const params = new URLSearchParams({ uuid, verifier });
		return this.fetchJson<AuthResult>(`/auth/poll?${params.toString()}`, {
			headers: { "content-type": "application/json" },
			signal: signal ?? null,
			validator: isAuthResult,
		});
	}

	async exchangeUserApiKey({
		token,
		signal,
	}: {
		token: string;
		signal?: AbortSignal | undefined;
	}) {
		return this.fetchJson<AuthResult>("/auth/exchange_user_api_key", {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({}),
			signal: signal ?? null,
			validator: isAuthResult,
		});
	}

	private async fetchJson<T>(
		url: string,
		{
			validator,
			...init
		}: RequestInit & { validator: (data: unknown) => data is T },
	): Promise<T> {
		const response = await fetch(`${this.baseUrl}${url}`, init);
		if (!response.ok) {
			const text = await response.text();
			throw new FetchError(response.status, url, text);
		}
		const data: unknown = await response.json();
		if (!validator(data)) {
			throw new Error(
				`Fetch failed ${url} for invalid response: ${JSON.stringify(data)}`,
			);
		}
		return data;
	}
}

function isAuthResult(data: unknown): data is AuthResult {
	return (
		typeof data === "object" &&
		data !== null &&
		"accessToken" in data &&
		"refreshToken" in data
	);
}
