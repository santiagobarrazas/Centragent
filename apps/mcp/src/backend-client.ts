type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal | undefined;
  query?: Record<string, string | number | undefined>;
};

/**
 * Per-request client. The inbound MCP bearer token (the caller's Centragent
 * identity) rides every backend call as `Authorization: Bearer`, so the API can
 * resolve which user/agent is acting and enforce the ownership invariant.
 */
export class BackendClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string | undefined
  ) {}

  async request<TResponse>(path: string, options: RequestOptions = {}) {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {};
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {})
    });

    const json = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | TResponse
      | null;

    if (!response.ok) {
      const message =
        json && typeof json === "object" && "error" in json && json.error?.message
          ? json.error.message
          : `Centragent API returned ${response.status}`;
      throw new Error(message);
    }

    return json as TResponse;
  }
}
