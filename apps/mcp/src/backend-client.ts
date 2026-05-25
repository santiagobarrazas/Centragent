type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal | undefined;
  query?: Record<string, string | number | undefined>;
};

export class BackendClient {
  constructor(private readonly baseUrl: string) {}

  async request<TResponse>(path: string, options: RequestOptions = {}) {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const init: RequestInit = {
      method: options.method ?? "GET",
      ...(options.body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(options.body)
          }),
      ...(options.signal ? { signal: options.signal } : {})
    };

    const response = await fetch(url, init);

    const json = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | TResponse
      | null;

    if (!response.ok) {
      const message =
        json &&
        typeof json === "object" &&
        "error" in json &&
        json.error?.message
          ? json.error.message
          : `Centragent API returned ${response.status}`;
      throw new Error(message);
    }

    return json as TResponse;
  }
}
