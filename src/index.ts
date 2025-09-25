#!/usr/bin/env node

/**
 * Tmux MCP Server - Entry point
 *
 * Intelligent terminal orchestrator MCP server that provides:
 * - Persistent tmux session management
 * - Real-time log capture and analysis
 * - Process and port monitoring
 * - Automated error detection
 * - Structured JSON-RPC 2.0 API
 */

import { TmuxMCPServer } from './server.js';
import { LogLevel } from './utils/logger.js';

// Main execution
async function main(): Promise<void> {
  const server = new TmuxMCPServer({
    logLevel: (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO,
    logDirectory: process.env.LOG_DIRECTORY || './logs',
    maxLogSize: parseInt(process.env.MAX_LOG_SIZE || '104857600', 10), // 100MB
    sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || '86400000', 10), // 24 hours
    enableLogging: process.env.ENABLE_LOGGING !== 'false',
    storageDirectory: process.env.STORAGE_DIRECTORY || './storage',
  });

  try {
    await server.initialize();
    await server.start();
  } catch (error) {
    console.error('Failed to start Tmux MCP Server:', error);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error in main:', error);
    process.exit(1);
  });
}

export { TmuxMCPServer };
export * from './types/index.js';
export * from './core/index.js';
export * from './utils/index.js';