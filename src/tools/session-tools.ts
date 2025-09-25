/**
 * Session Management Tools - MCP tool handlers for tmux session operations
 */

import { z } from 'zod';
import type { ToolContext } from '../types/index.js';

// Validation schemas
export const CreateSessionSchema = z.object({
  name: z.string().min(1, 'Session name is required'),
  workingDirectory: z.string().optional(),
  windows: z.array(z.object({
    name: z.string(),
    panes: z.array(z.object({
      command: z.string().optional(),
      workingDirectory: z.string().optional(),
    })).optional(),
  })).optional(),
  environment: z.record(z.string()).optional(),
});

export const CreatePaneSchema = z.object({
  sessionName: z.string().min(1, 'Session name is required'),
  windowIndex: z.number().int().min(0).optional().default(0),
  command: z.string().optional(),
});

export const ExecuteCommandSchema = z.object({
  paneId: z.string().min(1, 'Pane ID is required'),
  command: z.string().min(1, 'Command is required'),
});

export const DestroySessionSchema = z.object({
  sessionName: z.string().min(1, 'Session name is required'),
});

export const ListSessionsSchema = z.object({
  includeDetails: z.boolean().optional().default(true),
});

export const GetSessionSchema = z.object({
  sessionName: z.string().min(1, 'Session name is required'),
});

// Tool handlers
export async function handleCreateSession(args: any, context: ToolContext) {
  const validated = CreateSessionSchema.parse(args);
  const { logger, tmuxManager } = context;

  try {
    logger.info(`Creating tmux session: ${validated.name}`);

    const sessionConfig = {
      name: validated.name,
      workingDirectory: validated.workingDirectory,
      windows: validated.windows || [],
      environment: validated.environment,
    };

    const session = await tmuxManager.createSession(sessionConfig);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            session: {
              name: session.name,
              id: session.id,
              windows: session.windows.length,
              panes: session.windows.reduce((total, w) => total + w.panes.length, 0),
              created: session.created,
            },
            message: `Session '${session.name}' created successfully with ${session.windows.length} windows`,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error(`Failed to create session ${validated.name}:`, error);
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

export async function handleCreatePane(args: any, context: ToolContext) {
  const validated = CreatePaneSchema.parse(args);
  const { logger, tmuxManager } = context;

  try {
    logger.info(`Creating pane in session: ${validated.sessionName}`);

    const pane = await tmuxManager.createPane(
      validated.sessionName,
      validated.windowIndex,
      validated.command
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            pane: {
              id: pane.id,
              sessionName: pane.sessionName,
              windowId: pane.windowId,
              index: pane.index,
              command: pane.command,
              logFile: pane.logFile,
            },
            message: `Pane created successfully: ${pane.id}`,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error(`Failed to create pane:`, error);
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

export async function handleExecuteCommand(args: any, context: ToolContext) {
  const validated = ExecuteCommandSchema.parse(args);
  const { logger, tmuxManager } = context;

  try {
    logger.info(`Executing command in pane ${validated.paneId}: ${validated.command}`);

    await tmuxManager.executeCommand(validated.paneId, validated.command);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            paneId: validated.paneId,
            command: validated.command,
            message: `Command executed successfully in pane ${validated.paneId}`,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error(`Failed to execute command:`, error);
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

export async function handleListSessions(args: any, context: ToolContext) {
  const validated = ListSessionsSchema.parse(args);
  const { logger, tmuxManager } = context;

  try {
    logger.debug('Listing tmux sessions');

    const sessions = await tmuxManager.listSessions();

    const sessionData = validated.includeDetails
      ? sessions.map(session => ({
          name: session.name,
          id: session.id,
          created: session.created,
          attached: session.attached,
          windows: session.windows.length,
          totalPanes: session.windows.reduce((total, w) => total + w.panes.length, 0),
          windowDetails: session.windows.map(window => ({
            id: window.id,
            name: window.name,
            active: window.active,
            panes: window.panes.length,
          })),
        }))
      : sessions.map(session => ({
          name: session.name,
          windows: session.windows.length,
          panes: session.windows.reduce((total, w) => total + w.panes.length, 0),
          attached: session.attached,
        }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: sessions.length,
            sessions: sessionData,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to list sessions:', error);
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

export async function handleGetSession(args: any, context: ToolContext) {
  const validated = GetSessionSchema.parse(args);
  const { logger, tmuxManager } = context;

  try {
    logger.debug(`Getting session details: ${validated.sessionName}`);

    const session = await tmuxManager.getSession(validated.sessionName);

    if (!session) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Session '${validated.sessionName}' not found`,
            }, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            session: {
              name: session.name,
              id: session.id,
              created: session.created,
              attached: session.attached,
              windows: session.windows.map(window => ({
                id: window.id,
                name: window.name,
                active: window.active,
                panes: window.panes.map(pane => ({
                  id: pane.id,
                  index: pane.index,
                  title: pane.title,
                  command: pane.command,
                  pid: pane.pid,
                  active: pane.active,
                  logFile: pane.logFile,
                })),
              })),
            },
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error(`Failed to get session ${validated.sessionName}:`, error);
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

export async function handleDestroySession(args: any, context: ToolContext) {
  const validated = DestroySessionSchema.parse(args);
  const { logger, tmuxManager } = context;

  try {
    logger.info(`Destroying session: ${validated.sessionName}`);

    await tmuxManager.destroySession(validated.sessionName);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            sessionName: validated.sessionName,
            message: `Session '${validated.sessionName}' destroyed successfully`,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error(`Failed to destroy session ${validated.sessionName}:`, error);
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