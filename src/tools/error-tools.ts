/**
 * Error Watching Tools - MCP tool handlers for real-time error detection
 */

import { z } from 'zod';
import type { ToolContext } from '../types/index.js';

// Validation schemas
export const ErrorWatchSchema = z.object({
  paneId: z.string().min(1, 'Pane ID is required'),
  languages: z.array(z.string()).optional(),
  watchDuration: z.number().int().min(10).max(3600).optional().default(300), // 5 minutes default
});

export const ErrorSummarySchema = z.object({
  paneId: z.string().optional(),
  timeRange: z.enum(['hour', 'day', 'all']).optional().default('all'),
  includeWarnings: z.boolean().optional().default(true),
});

export const ErrorClearSchema = z.object({
  paneId: z.string().optional(),
  errorType: z.enum(['errors', 'warnings', 'all']).optional().default('all'),
});

export const ErrorAnalyzeSchema = z.object({
  paneId: z.string().min(1, 'Pane ID is required'),
  includePatterns: z.boolean().optional().default(true),
  includeTrends: z.boolean().optional().default(true),
});

export const AddPatternSchema = z.object({
  name: z.string().min(1, 'Pattern name is required'),
  regex: z.string().min(1, 'Regex pattern is required'),
  type: z.enum(['error', 'warning', 'info']),
  language: z.string().optional(),
  captureGroups: z.object({
    file: z.number().int().optional(),
    line: z.number().int().optional(),
    column: z.number().int().optional(),
    message: z.number().int(),
  }),
});

export const StopWatchSchema = z.object({
  paneId: z.string().min(1, 'Pane ID is required'),
});

// Tool handlers
export async function handleErrorWatch(args: any, context: ToolContext) {
  const validated = ErrorWatchSchema.parse(args);
  const { logger, tmuxManager, errorWatcher } = context;

  try {
    logger.info(`Starting error watching for pane: ${validated.paneId}`);

    // Find the pane
    const sessions = await tmuxManager.listSessions();
    let targetPane: any = null;

    for (const session of sessions) {
      for (const window of session.windows) {
        for (const pane of window.panes) {
          if (pane.id === validated.paneId) {
            targetPane = pane;
            break;
          }
        }
      }
    }

    if (!targetPane) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Pane ${validated.paneId} not found`,
            }, null, 2),
          },
        ],
      };
    }

    // Start watching
    await errorWatcher.startWatching(targetPane);

    // Get initial error summary
    const initialSummary = errorWatcher.getErrorSummary(validated.paneId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            paneId: validated.paneId,
            watchDuration: validated.watchDuration,
            languages: validated.languages,
            initialSummary,
            message: `Error watching started for pane ${validated.paneId}`,
            note: 'Use errors:summary to check for detected errors',
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to start error watching:', error);
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

export async function handleErrorSummary(args: any, context: ToolContext) {
  const validated = ErrorSummarySchema.parse(args);
  const { logger, errorWatcher } = context;

  try {
    logger.debug(`Getting error summary for: ${validated.paneId || 'all panes'}`);

    const summary = errorWatcher.getErrorSummary(validated.paneId);
    const allErrors = validated.paneId
      ? new Map([[validated.paneId, errorWatcher.getErrors(validated.paneId)]])
      : errorWatcher.getAllErrors();

    // Filter by time range
    const now = new Date();
    const cutoffTime = (() => {
      switch (validated.timeRange) {
        case 'hour':
          return new Date(now.getTime() - 60 * 60 * 1000);
        case 'day':
          return new Date(now.getTime() - 24 * 60 * 60 * 1000);
        default:
          return new Date(0); // All time
      }
    })();

    const filteredErrors = new Map();
    for (const [paneId, errors] of allErrors) {
      const timeFilteredErrors = errors.filter((error: any) => error.timestamp >= cutoffTime);

      if (!validated.includeWarnings) {
        filteredErrors.set(paneId, timeFilteredErrors.filter((error: any) => error.type === 'error'));
      } else {
        filteredErrors.set(paneId, timeFilteredErrors);
      }
    }

    // Calculate summary stats
    let totalErrors = 0;
    let totalWarnings = 0;
    const paneStats: any[] = [];

    for (const [paneId, errors] of filteredErrors) {
      const errorCount = errors.filter((e: any) => e.type === 'error').length;
      const warningCount = errors.filter((e: any) => e.type === 'warning').length;

      totalErrors += errorCount;
      totalWarnings += warningCount;

      if (errors.length > 0) {
        paneStats.push({
          paneId,
          errors: errorCount,
          warnings: warningCount,
          latest: errors[errors.length - 1],
        });
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            timeRange: validated.timeRange,
            includeWarnings: validated.includeWarnings,
            summary: {
              totalErrors,
              totalWarnings,
              activePanes: paneStats.length,
              watchedPanes: errorWatcher.getWatchedPanes(),
            },
            paneStats,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to get error summary:', error);
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

export async function handleErrorClear(args: any, context: ToolContext) {
  const validated = ErrorClearSchema.parse(args);
  const { logger, errorWatcher } = context;

  try {
    logger.info(`Clearing errors for: ${validated.paneId || 'all panes'}`);

    errorWatcher.clearErrors(validated.paneId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            paneId: validated.paneId || 'all',
            errorType: validated.errorType,
            message: `Cleared ${validated.errorType} for ${validated.paneId || 'all panes'}`,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to clear errors:', error);
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

export async function handleErrorAnalyze(args: any, context: ToolContext) {
  const validated = ErrorAnalyzeSchema.parse(args);
  const { logger, errorWatcher } = context;

  try {
    logger.info(`Analyzing errors for pane: ${validated.paneId}`);

    const analysis = await errorWatcher.analyzeErrors(validated.paneId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            paneId: validated.paneId,
            analysis: {
              recentErrors: analysis.recentErrors,
              topFiles: analysis.topFiles,
              errorTypes: analysis.errorTypes,
              trends: analysis.trends,
            },
            insights: {
              mostProblematicFile: analysis.topFiles[0]?.file || 'None',
              errorRate: {
                lastHour: analysis.trends.lastHour,
                lastDay: analysis.trends.lastDay,
              },
              dominantErrorType: analysis.errorTypes[0]?.type || 'None',
            },
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to analyze errors:', error);
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

export async function handleAddPattern(args: any, context: ToolContext) {
  const validated = AddPatternSchema.parse(args);
  const { logger, errorWatcher } = context;

  try {
    logger.info(`Adding custom error pattern: ${validated.name}`);

    const pattern = {
      name: validated.name,
      regex: new RegExp(validated.regex),
      type: validated.type,
      language: validated.language,
      captureGroups: validated.captureGroups,
    };

    errorWatcher.addCustomPattern(pattern);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            pattern: {
              name: validated.name,
              regex: validated.regex,
              type: validated.type,
              language: validated.language,
            },
            message: `Custom error pattern '${validated.name}' added successfully`,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to add custom pattern:', error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Invalid regex pattern or configuration',
          }, null, 2),
        },
      ],
    };
  }
}

export async function handleStopWatch(args: any, context: ToolContext) {
  const validated = StopWatchSchema.parse(args);

  const { logger, errorWatcher } = context;

  try {
    logger.info(`Stopping error watching for pane: ${validated.paneId}`);

    await errorWatcher.stopWatching(validated.paneId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            paneId: validated.paneId,
            message: `Error watching stopped for pane ${validated.paneId}`,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to stop error watching:', error);
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