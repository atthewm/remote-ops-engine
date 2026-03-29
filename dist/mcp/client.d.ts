/**
 * MCP Client Manager.
 * Spawns child processes for each MCP server and manages tool calls.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
export declare function connectServer(name: string): Promise<Client>;
export declare function callTool(serverName: string, toolName: string, args?: Record<string, unknown>): Promise<unknown>;
export declare function disconnectAll(): Promise<void>;
export declare function healthCheck(): Promise<Record<string, {
    status: string;
    message: string;
}>>;
