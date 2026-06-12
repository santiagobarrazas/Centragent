type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal | undefined;
  query?: Record<string, string | number | undefined>;
};

/** Token-bound HTTP client — the runner acts AS one agent on every call. */
export class BackendClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async request<TResponse>(path: string, options: RequestOptions = {}): Promise<TResponse> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (options.body !== undefined) headers["content-type"] = "application/json";

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
          : `Centragent API ${response.status}`;
      throw new Error(message);
    }
    return json as TResponse;
  }
}
