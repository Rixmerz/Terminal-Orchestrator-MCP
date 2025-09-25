/**
 * MCP Tools Registration - Complete tool registration with JSON Schema conversion
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolContext } from '../types/index.js';

// Import tool handlers and schemas
import {
  handleCreateSession,
  handleCreatePane,
  handleExecuteCommand,
  handleListSessions,
  handleGetSession,
  handleDestroySession,
  CreateSessionSchema,
  CreatePaneSchema,
  ExecuteCommandSchema,
  ListSessionsSchema,
  GetSessionSchema,
  DestroySessionSchema,
} from './session-tools.js';

import {
  handleGetRecentLogs,
  handleSummarizeLogs,
  handleSearchLogs,
  handleWatchLogs,
  handleGenerateReport,
  GetRecentLogsSchema,
  SummarizeLogsSchema,
  SearchLogsSchema,
  WatchLogsSchema,
  GenerateReportSchema,
} from './log-tools.js';

import {
  handleListPorts,
  handleMultiKill,
  handleProcessMonitor,
  handleProcessRestart,
  handlePortMonitor,
  handleSystemLoad,
  ListPortsSchema,
  MultiKillSchema,
  ProcessMonitorSchema,
  ProcessRestartSchema,
  PortMonitorSchema,
  SystemLoadSchema,
} from './process-tools.js';

import {
  handleErrorWatch,
  handleErrorSummary,
  handleErrorClear,
  handleErrorAnalyze,
  handleAddPattern,
  handleStopWatch,
  ErrorWatchSchema,
  ErrorSummarySchema,
  ErrorClearSchema,
  ErrorAnalyzeSchema,
  AddPatternSchema,
  StopWatchSchema,
} from './error-tools.js';

export async function registerTools(server: Server, context: ToolContext): Promise<void> {
  const { logger } = context;

  logger.info('Registering all 23 MCP tools with JSON Schema conversion...');

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'tmux_create_session':
        return await handleCreateSession(args, context);
      case 'tmux_create_pane':
        return await handleCreatePane(args, context);
      case 'tmux_execute_command':
        return await handleExecuteCommand(args, context);
      case 'tmux_list_sessions':
        return await handleListSessions(args, context);
      case 'tmux_get_session':
        return await handleGetSession(args, context);
      case 'tmux_destroy_session':
        return await handleDestroySession(args, context);

      // Log Analysis Tools
      case 'logs_get_recent':
        return await handleGetRecentLogs(args, context);
      case 'logs_summarize':
        return await handleSummarizeLogs(args, context);
      case 'logs_search':
        return await handleSearchLogs(args, context);
      case 'logs_watch':
        return await handleWatchLogs(args, context);
      case 'logs_generate_report':
        return await handleGenerateReport(args, context);

      // Process Management Tools
      case 'process_list_ports':
        return await handleListPorts(args, context);
      case 'process_multi_kill':
        return await handleMultiKill(args, context);
      case 'process_monitor':
        return await handleProcessMonitor(args, context);
      case 'process_restart':
        return await handleProcessRestart(args, context);
      case 'process_port_monitor':
        return await handlePortMonitor(args, context);
      case 'process_system_load':
        return await handleSystemLoad(args, context);

      // Error Watching Tools
      case 'errors_watch':
        return await handleErrorWatch(args, context);
      case 'errors_summary':
        return await handleErrorSummary(args, context);
      case 'errors_clear':
        return await handleErrorClear(args, context);
      case 'errors_analyze':
        return await handleErrorAnalyze(args, context);
      case 'errors_add_pattern':
        return await handleAddPattern(args, context);
      case 'errors_stop_watch':
        return await handleStopWatch(args, context);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  // Register tools/list handler to expose all tools with their schemas
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        // Session Management Tools
        {
          name: 'tmux_create_session',
          description: 'Create a new tmux session with optional windows and panes',
          inputSchema: zodToJsonSchema(CreateSessionSchema),
        },
        {
          name: 'tmux_create_pane',
          description: 'Create a new pane in an existing session window',
          inputSchema: zodToJsonSchema(CreatePaneSchema),
        },
        {
          name: 'tmux_execute_command',
          description: 'Execute a command in a specific pane',
          inputSchema: zodToJsonSchema(ExecuteCommandSchema),
        },
        {
          name: 'tmux_list_sessions',
          description: 'List all active tmux sessions',
          inputSchema: zodToJsonSchema(ListSessionsSchema),
        },
        {
          name: 'tmux_get_session',
          description: 'Get detailed information about a specific session',
          inputSchema: zodToJsonSchema(GetSessionSchema),
        },
        {
          name: 'tmux_destroy_session',
          description: 'Destroy a tmux session and all its panes',
          inputSchema: zodToJsonSchema(DestroySessionSchema),
        },
        // Log Analysis Tools
        {
          name: 'logs_get_recent',
          description: 'Get recent log entries from a pane',
          inputSchema: zodToJsonSchema(GetRecentLogsSchema),
        },
        {
          name: 'logs_summarize',
          description: 'Analyze and summarize logs from a pane',
          inputSchema: zodToJsonSchema(SummarizeLogsSchema),
        },
        {
          name: 'logs_search',
          description: 'Search for patterns in pane logs',
          inputSchema: zodToJsonSchema(SearchLogsSchema),
        },
        {
          name: 'logs_watch',
          description: 'Start watching logs for real-time updates',
          inputSchema: zodToJsonSchema(WatchLogsSchema),
        },
        {
          name: 'logs_generate_report',
          description: 'Generate comprehensive log analysis report',
          inputSchema: zodToJsonSchema(GenerateReportSchema),
        },
        // Process Management Tools
        {
          name: 'process_list_ports',
          description: 'List open ports and their associated processes',
          inputSchema: zodToJsonSchema(ListPortsSchema),
        },
        {
          name: 'process_multi_kill',
          description: 'Kill multiple processes matching a pattern',
          inputSchema: zodToJsonSchema(MultiKillSchema),
        },
        {
          name: 'process_monitor',
          description: 'Monitor running processes with resource usage',
          inputSchema: zodToJsonSchema(ProcessMonitorSchema),
        },
        {
          name: 'process_restart',
          description: 'Restart processes matching a pattern',
          inputSchema: zodToJsonSchema(ProcessRestartSchema),
        },
        {
          name: 'process_port_monitor',
          description: 'Monitor a specific port for activity',
          inputSchema: zodToJsonSchema(PortMonitorSchema),
        },
        {
          name: 'process_system_load',
          description: 'Get system load averages and top processes',
          inputSchema: zodToJsonSchema(SystemLoadSchema),
        },
        // Error Watching Tools
        {
          name: 'errors_watch',
          description: 'Start real-time error detection for a pane',
          inputSchema: zodToJsonSchema(ErrorWatchSchema),
        },
        {
          name: 'errors_summary',
          description: 'Get summary of detected errors and warnings',
          inputSchema: zodToJsonSchema(ErrorSummarySchema),
        },
        {
          name: 'errors_clear',
          description: 'Clear error cache for panes',
          inputSchema: zodToJsonSchema(ErrorClearSchema),
        },
        {
          name: 'errors_analyze',
          description: 'Analyze error patterns and trends for a pane',
          inputSchema: zodToJsonSchema(ErrorAnalyzeSchema),
        },
        {
          name: 'errors_add_pattern',
          description: 'Add custom error detection pattern',
          inputSchema: zodToJsonSchema(AddPatternSchema),
        },
        {
          name: 'errors_stop_watch',
          description: 'Stop error watching for a pane',
          inputSchema: zodToJsonSchema(StopWatchSchema),
        },
      ],
    };
  });

  logger.info('Successfully registered all 23 MCP tools with JSON Schema conversion');
}


