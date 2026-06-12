#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOKEN_ENV_VAR } from "@centragent/shared";
import { BackendClient } from "./backend-client.js";
import { config } from "./config.js";
import { createCentragentMcpServer } from "./server.js";

// stdio installs carry the token in the environment (zero-network, no header).
const token = process.env[TOKEN_ENV_VAR];
const backend = new BackendClient(config.CENTRAGENT_API_URL, token);
const server = createCentragentMcpServer(backend);
const transport = new StdioServerTransport();

await server.connect(transport);
