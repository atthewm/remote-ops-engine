/**
 * MCP Client Manager.
 * Spawns child processes for each MCP server and manages tool calls.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../util/logger.js';

interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

const SERVER_CONFIGS: Record<string, McpServerConfig> = {
  marginedge: {
    name: 'marginedge',
    command: 'node',
    args: [process.env.MARGINEDGE_MCP_PATH ?? `${process.env.HOME}/marginedge-mcp-server/dist/index.js`],
    env: {
      MARGINEDGE_API_KEY: process.env.MARGINEDGE_API_KEY ?? '',
      MARGINEDGE_RESTAURANT_ID: process.env.MARGINEDGE_RESTAURANT_ID ?? '945747948',
      TRANSPORT: 'stdio',
    },
  },
  toast: {
    name: 'toast',
    command: 'node',
    args: [process.env.TOAST_MCP_PATH ?? `${process.env.HOME}/toast-mcp-server/dist/index.js`],
    env: {
      TOAST_CLIENT_ID: process.env.TOAST_CLIENT_ID ?? '',
      TOAST_CLIENT_SECRET: process.env.TOAST_CLIENT_SECRET ?? '',
      TOAST_RESTAURANT_GUID: process.env.TOAST_RESTAURANT_GUID ?? 'c227349d-7778-4ec2-af27-e386eb2ec52e',
      TRANSPORT: 'stdio',
    },
  },
  m365: {
    name: 'm365',
    command: 'node',
    args: [process.env.M365_MCP_PATH ?? `${process.env.HOME}/remote-m365-mcp/dist/index.js`],
    env: {
      REMOTE_M365_CLIENT_ID: process.env.REMOTE_M365_CLIENT_ID ?? '',
      TRANSPORT: 'stdio',
    },
  },
};

const clients: Map<string, Client> = new Map();
const transports: Map<string, StdioClientTransport> = new Map();

export async function connectServer(name: string): Promise<Client> {
  if (clients.has(name)) return clients.get(name)!;

  const config = SERVER_CONFIGS[name];
  if (!config) throw new Error(`Unknown MCP server: ${name}`);

  logger.info(`Connecting to MCP server: ${name}`);

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...process.env, ...config.env } as Record<string, string>,
  });

  const client = new Client({ name: `ops-engine-${name}`, version: '0.1.0' }, {});
  await client.connect(transport);

  clients.set(name, client);
  transports.set(name, transport);

  logger.info(`Connected to ${name} MCP server`);
  return client;
}

export async function callTool(serverName: string, toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const client = await connectServer(serverName);
  logger.debug(`Calling ${serverName}.${toolName}`, { args });

  try {
    const result = await client.callTool({ name: toolName, arguments: args });

    if (result.isError) {
      logger.error(`Tool call failed: ${serverName}.${toolName}`, { error: result.content });
      throw new Error(`MCP tool error on ${serverName}.${toolName}: ${JSON.stringify(result.content)}`);
    }

    // Extract text content from MCP response
    const textContent = (result.content as Array<{ type: string; text?: string }>)
      ?.find(c => c.type === 'text');

    if (textContent?.text) {
      try {
        return JSON.parse(textContent.text);
      } catch {
        return textContent.text;
      }
    }

    return result.content;
  } catch (err) {
    logger.error(`Tool call exception on ${serverName}.${toolName}`, { error: String(err) });
    throw err;
  }
}

export async function disconnectAll(): Promise<void> {
  for (const [name, transport] of transports) {
    try {
      await transport.close();
      logger.info(`Disconnected from ${name}`);
    } catch (err) {
      logger.warn(`Error disconnecting ${name}`, { error: String(err) });
    }
  }
  clients.clear();
  transports.clear();
}

export async function healthCheck(): Promise<Record<string, { status: string; message: string }>> {
  const results: Record<string, { status: string; message: string }> = {};

  for (const name of Object.keys(SERVER_CONFIGS)) {
    try {
      const toolName = name === 'm365'
        ? 'user_profile'
        : name === 'marginedge'
          ? 'marginedge_healthcheck'
          : 'toast_healthcheck';
      await callTool(name, toolName);
      results[name] = { status: 'healthy', message: 'Connected and responsive' };
    } catch (err) {
      results[name] = { status: 'unhealthy', message: String(err) };
    }
  }

  return results;
}
