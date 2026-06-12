import express from "express";
import cors from "cors";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BackendClient } from "./backend-client.js";
import { config } from "./config.js";
import { createCentragentMcpServer } from "./server.js";

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "centragent-mcp",
    transport: "streamable-http",
    apiUrl: config.CENTRAGENT_API_URL
  });
});

const bearerOf = (header: string | undefined) =>
  header && header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim() || undefined
    : undefined;

app.post("/mcp", async (request, response) => {
  // The caller's identity is the bearer token; thread it into a request-scoped
  // backend so every API call this MCP session makes is made AS that identity.
  const token = bearerOf(request.headers.authorization);
  const backend = new BackendClient(config.CENTRAGENT_API_URL, token);
  const server = createCentragentMcpServer(backend);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  } as unknown as StreamableHTTPServerTransportOptions);

  response.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport as never);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    console.error("MCP request failed", error);
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal MCP server error" },
        id: null
      });
    }
  }
});

app.get("/mcp", (_request, response) => {
  response.status(405).json({
    error: "This Centragent MCP server uses stateless Streamable HTTP POST /mcp."
  });
});

app.listen(config.MCP_PORT, config.MCP_HOST, () => {
  console.error(
    `Centragent MCP Streamable HTTP listening at http://${config.MCP_HOST}:${config.MCP_PORT}/mcp`
  );
});
