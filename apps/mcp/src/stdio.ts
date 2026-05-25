#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BackendClient } from "./backend-client.js";
import { config } from "./config.js";
import { createCentragentMcpServer } from "./server.js";

const backend = new BackendClient(config.CENTRAGENT_API_URL);
const server = createCentragentMcpServer(backend);
const transport = new StdioServerTransport();

await server.connect(transport);
