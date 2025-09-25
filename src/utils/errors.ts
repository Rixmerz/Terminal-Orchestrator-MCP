/**
 * Error handling utilities for terminal-orchestrator-mcp
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from './logger.js';

export class ErrorHandler {
  constructor(private logger: Logger) {}

  handleToolError(error: unknown, toolName: string) {
    this.logger.error(`Tool ${toolName} error:`, error);

    if (error instanceof McpError) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Tool error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }

    if (error instanceof Error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Tool error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Tool error: Unknown error occurred`,
        },
      ],
      isError: true,
    };
  }

  createValidationError(message: string): McpError {
    return new McpError(ErrorCode.InvalidParams, message);
  }

  createNotFoundError(resource: string): McpError {
    return new McpError(ErrorCode.MethodNotFound, `Resource not found: ${resource}`);
  }

  createInternalError(message: string): McpError {
    return new McpError(ErrorCode.InternalError, message);
  }

  wrapAsync<T>(fn: () => Promise<T>): Promise<T> {
    return fn().catch((error) => {
      this.logger.error('Async operation failed:', error);
      throw error;
    });
  }
}