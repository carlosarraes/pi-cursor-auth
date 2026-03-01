import { createHash, randomBytes } from "node:crypto";
import type { OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import type Auth from "../api/auth";
import { FetchError } from "../api/auth";
import { backoff } from "./backoff";

type JwtPayload = { exp: number; [key: string]: unknown };

const base64URLEncode = (buffer: Buffer) =>
	buffer
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "");

const decodeJwt = (token: string): JwtPayload | null => {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const b64 = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
		return JSON.parse(atob(b64)) as JwtPayload;
	} catch {
		return null;
	}
};

const getTokenExpiry = (token: string): number => {
	const decoded = decodeJwt(token);
	if (!decoded || typeof decoded.exp !== "number") return Date.now() + 3600_000;
	return decoded.exp * 1000 - 5 * 60_000;
};

export default class AuthManager {
	constructor(
		private readonly auth: Auth,
		private readonly websiteUrl: string,
	) {}

	async login({
		onAuth,
		onProgress,
		signal,
	}: {
		onAuth: (info: { url: string; instructions: string }) => void;
		onProgress?: OAuthLoginCallbacks["onProgress"];
		signal?: AbortSignal;
	}) {
		const verifier = base64URLEncode(randomBytes(32));
		const challenge = base64URLEncode(
			createHash("sha256").update(verifier).digest(),
		);
		const uuid = crypto.randomUUID();
		const loginUrl = `${this.websiteUrl}/loginDeepControl?challenge=${challenge}&uuid=${uuid}&mode=login&redirectTarget=cli`;

		onAuth({
			url: loginUrl,
			instructions: "Complete the sign-in in your browser.",
		});

		return backoff(
			async () => {
				onProgress?.("Polling authentication status...");
				const { accessToken, refreshToken } = await this.auth.poll({
					uuid,
					verifier,
					signal,
				});
				return {
					access: accessToken,
					refresh: refreshToken,
					expires: getTokenExpiry(accessToken),
				};
			},
			{
				retries: 150,
				delay: 1000,
				shouldRetry: (error) =>
					error instanceof FetchError && error.status === 404,
			},
		);
	}

	async refresh(credentials: {
		access: string;
		refresh: string;
	}): Promise<{ access: string; refresh: string; expires: number }> {
		if (!credentials.access && !credentials.refresh) {
			throw new Error("No credentials provided");
		}
		try {
			const { accessToken, refreshToken } = await this.auth.exchangeUserApiKey({
				token: credentials.refresh || credentials.access,
			});
			return {
				access: accessToken,
				refresh: refreshToken,
				expires: getTokenExpiry(accessToken),
			};
		} catch {
			if (credentials.access && credentials.refresh) {
				return this.refresh({ access: credentials.access, refresh: "" });
			}
			throw new Error("Failed to refresh credentials");
		}
	}
}
