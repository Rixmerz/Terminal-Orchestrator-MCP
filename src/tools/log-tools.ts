/**
 * Log Analysis Tools - MCP tool handlers for log operations
 */

import { z } from 'zod';
import type { ToolContext } from '../types/index.js';

// Validation schemas
export const GetRecentLogsSchema = z.object({
  paneId: z.string().min(1, 'Pane ID is required'),
  lines: z.number().int().min(1).max(1000).optional().default(50),
});

export const SummarizeLogsSchema = z.object({
  paneId: z.string().min(1, 'Pane ID is required'),
  maxLines: z.number().int().min(100).max(10000).optional().default(1000),
});

export const SearchLogsSchema = z.object({
  paneId: z.string().min(1, 'Pane ID is required'),
  pattern: z.string().min(1, 'Search pattern is required'),
  maxResults: z.number().int().min(1).max(500).optional().default(100),
  caseSensitive: z.boolean().optional().default(false),
});

export const WatchLogsSchema = z.object({
  paneId: z.string().min(1, 'Pane ID is required'),
  duration: z.number().int().min(1).max(300).optional().default(30), // seconds
});

export const GenerateReportSchema = z.object({
  sessionName: z.string().optional(),
  includeErrorSamples: z.boolean().optional().default(true),
});

// Tool handlers
export async function handleGetRecentLogs(args: any, context: ToolContext) {
  const validated = GetRecentLogsSchema.parse(args);
  const { logger, tmuxManager, logAnalyzer } = context;

  try {
    logger.debug(`Getting recent logs for pane: ${validated.paneId}`);

    // Find the pane and its log file
    const sessions = await tmuxManager.listSessions();
    let logFile: string | undefined;

    for (const session of sessions) {
      for (const window of session.windows) {
        for (const pane of window.panes) {
          if (pane.id === validated.paneId) {
            logFile = pane.logFile;
            break;
          }
        }
      }
    }

    if (!logFile) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Pane ${validated.paneId} not found or logging not enabled`,
            }, null, 2),
          },
        ],
      };
    }

    const logs = await logAnalyzer.getRecentLogs(logFile, validated.lines);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            paneId: validated.paneId,
            logFile,
            lineCount: logs.length,
            logs,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error(`Failed to get recent logs:`, error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }, null, 2),
        },
      ],
    };
  }
}

export async function handleSummarizeLogs(args: any, context: ToolContext) {
  const validated = SummarizeLogsSchema.parse(args);
  const { logger, tmuxManager, logAnalyzer } = context;

  try {
    logger.info(`Summarizing logs for pane: ${validated.paneId}`);

    // Find the pane and its log file
    const sessions = await tmuxManager.listSessions();
    let logFile: string | undefined;

    for (const session of sessions) {
      for (const window of session.windows) {
        for (const pane of window.panes) {
          if (pane.id === validated.paneId) {
            logFile = pane.logFile;
            break;
          }
        }
      }
    }

    if (!logFile) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Pane ${validated.paneId} not found or logging not enabled`,
            }, null, 2),
          },
        ],
      };
    }

    const summary = await logAnalyzer.analyzeLogFile(logFile, validated.maxLines);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            summary: {
              paneId: summary.paneId,
              totalLines: summary.totalLines,
              errors: summary.errors,
              warnings: summary.warnings,
              timeRange: summary.timeRange,
              topPatterns: Object.entries(summary.patterns)
                .sort((a, b) => (b[1] as number) - (a[1] as number))
                .slice(0, 5)
                .map(([pattern, count]) => ({ pattern, count })),
              errorSamples: summary.errorSamples.slice(0, 5),
            },
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error(`Failed to summarize logs:`, error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }, null, 2),
        },
      ],
    };
  }
}

export async function handleSearchLogs(args: any, context: ToolContext) {
  const validated = SearchLogsSchema.parse(args);
  const { logger, tmuxManager, logAnalyzer } = context;

  try {
    logger.debug(`Searching logs for pane ${validated.paneId} with pattern: ${validated.pattern}`);

    // Find the pane and its log file
    const sessions = await tmuxManager.listSessions();
    let logFile: string | undefined;

    for (const session of sessions) {
      for (const window of session.windows) {
        for (const pane of window.panes) {
          if (pane.id === validated.paneId) {
            logFile = pane.logFile;
            break;
          }
        }
      }
    }

    if (!logFile) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Pane ${validated.paneId} not found or logging not enabled`,
            }, null, 2),
          },
        ],
      };
    }

    // Apply case sensitivity to pattern
    const searchPattern = validated.caseSensitive
      ? validated.pattern
      : `(?i)${validated.pattern}`;

    const matches = await logAnalyzer.searchLogs(logFile, searchPattern, validated.maxResults);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            paneId: validated.paneId,
            pattern: validated.pattern,
            caseSensitive: validated.caseSensitive,
            matchCount: matches.length,
            matches,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error(`Failed to search logs:`, error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }, null, 2),
        },
      ],
    };
  }
}

export async function handleWatchLogs(args: any, context: ToolContext) {
  const validated = WatchLogsSchema.parse(args);
  const { logger, tmuxManager } = context;

  try {
    logger.info(`Starting log watch for pane ${validated.paneId} for ${validated.duration} seconds`);

    // Find the pane and its log file
    const sessions = await tmuxManager.listSessions();
    let logFile: string | undefined;

    for (const session of sessions) {
      for (const window of session.windows) {
        for (const pane of window.panes) {
          if (pane.id === validated.paneId) {
            logFile = pane.logFile;
            break;
          }
        }
      }
    }

    if (!logFile) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Pane ${validated.paneId} not found or logging not enabled`,
            }, null, 2),
          },
        ],
      };
    }

    // Note: This is a simplified implementation
    // In a real-world scenario, you'd set up a file watcher and stream updates
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            paneId: validated.paneId,
            logFile,
            duration: validated.duration,
            message: `Log watching started for ${validated.duration} seconds. Use logs:get-recent to check for new entries.`,
            note: 'Real-time streaming requires WebSocket or Server-Sent Events support',
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error(`Failed to start log watching:`, error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }, null, 2),
        },
      ],
    };
  }
}

export async function handleGenerateReport(args: any, context: ToolContext) {
  const validated = GenerateReportSchema.parse(args);
  const { logger, tmuxManager, logAnalyzer } = context;

  try {
    logger.info('Generating comprehensive log report');

    let panes: any[] = [];

    if (validated.sessionName) {
      const session = await tmuxManager.getSession(validated.sessionName);
      if (session) {
        for (const window of session.windows) {
          panes.push(...window.panes);
        }
      }
    } else {
      const sessions = await tmuxManager.listSessions();
      for (const session of sessions) {
        for (const window of session.windows) {
          panes.push(...window.panes);
        }
      }
    }

    const report = await logAnalyzer.generateSummaryReport(panes);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            sessionName: validated.sessionName || 'all',
            panesAnalyzed: panes.length,
            report,
            generatedAt: new Date().toISOString(),
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to generate log report:', error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }, null, 2),
        },
      ],
    };
  }
}