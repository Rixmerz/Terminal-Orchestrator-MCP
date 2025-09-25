/**
 * Tmux Manager - Core tmux operations and session management
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { mkdir, access } from 'fs/promises';
import type {
  TmuxSession,
  TmuxPane,
  TmuxWindow,
  SessionConfig,
  TmuxManagerOptions
} from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { CommandEscaper } from '../utils/command-escaper.js';
import { PaneIdResolver } from '../utils/pane-id-resolver.js';
import { FrameworkDetector } from '../utils/framework-detector.js';

export class TmuxManager {
  private options: TmuxManagerOptions;
  private commandEscaper: CommandEscaper;
  private paneIdResolver: PaneIdResolver;
  private frameworkDetector: FrameworkDetector;

  constructor(
    private logger: Logger,
    options: Partial<TmuxManagerOptions> = {}
  ) {
    this.options = {
      logDirectory: options.logDirectory || './logs',
      maxLogSize: options.maxLogSize || 100 * 1024 * 1024, // 100MB
      enableLogging: options.enableLogging ?? true,
      sessionTimeout: options.sessionTimeout || 24 * 60 * 60 * 1000, // 24 hours
    };

    // Initialize utilities
    this.commandEscaper = new CommandEscaper(logger, {
      allowDangerous: false,
      logCommands: true,
      defaultTimeout: 30000,
    });
    this.paneIdResolver = new PaneIdResolver(logger);
    this.frameworkDetector = new FrameworkDetector(logger);
  }

  async initialize(): Promise<void> {
    try {
      // Ensure log directory exists
      await mkdir(this.options.logDirectory, { recursive: true });

      // Check if tmux is available
      await this.checkTmuxAvailable();

      this.logger.info('TmuxManager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize TmuxManager:', error);
      throw error;
    }
  }

  private async checkTmuxAvailable(): Promise<void> {
    try {
      await this.commandEscaper.executeTmuxCommand('-V');
    } catch (error) {
      throw new Error('tmux is not available. Please install tmux to use this MCP server.');
    }
  }

  async createSession(config: SessionConfig): Promise<TmuxSession> {
    try {
      this.logger.info(`Creating tmux session: ${config.name}`);

      // Check if session already exists
      const existing = await this.getSession(config.name);
      if (existing) {
        throw new Error(`Session ${config.name} already exists`);
      }

      // Create new session detached
      const createArgs = [
        'new-session',
        '-d',
        '-s', config.name,
        '-c', config.workingDirectory || process.cwd()
      ];

      if (config.windows && config.windows[0]?.panes?.[0]?.command) {
        createArgs.push(config.windows[0].panes[0].command);
      }

      await this.commandEscaper.executeTmuxCommand('new-session', createArgs.slice(1));

      // Setup environment variables if provided
      if (config.environment) {
        for (const [key, value] of Object.entries(config.environment)) {
          await this.commandEscaper.executeTmuxCommand('set-environment', [
            '-t', config.name, key, value
          ]);
        }
      }

      // Create additional windows and panes
      if (config.windows) {
        await this.setupWindows(config.name, config.windows);
      }

      // Enable logging for all panes
      if (this.options.enableLogging) {
        await this.enableLoggingForSession(config.name);
      }

      const session = await this.getSession(config.name);
      if (!session) {
        throw new Error('Failed to create session');
      }

      this.logger.info(`Session ${config.name} created successfully`);
      return session;

    } catch (error) {
      this.logger.error(`Failed to create session ${config.name}:`, error);
      throw error;
    }
  }

  private async setupWindows(sessionName: string, windows: SessionConfig['windows']): Promise<void> {
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i];

      if (i === 0) {
        // Rename first window
        await this.commandEscaper.executeTmuxCommand('rename-window', [
          '-t', `${sessionName}:0`, window.name
        ]);
      } else {
        // Create new window
        await this.commandEscaper.executeTmuxCommand('new-window', [
          '-t', sessionName, '-n', window.name
        ]);
      }

      // Setup panes in this window
      if (window.panes && window.panes.length > 1) {
        for (let j = 1; j < window.panes.length; j++) {
          await this.commandEscaper.executeTmuxCommand('split-window', [
            '-t', `${sessionName}:${i}`
          ]);
        }

        // Send commands to panes
        for (let j = 0; j < window.panes.length; j++) {
          const pane = window.panes[j];
          if (pane.command) {
            const paneTarget = `${sessionName}:${i}.${j}`;
            await this.commandEscaper.sendKeysToPane(paneTarget, pane.command);
          }
        }
      } else if (window.panes?.[0]?.command) {
        const paneTarget = `${sessionName}:${i}`;
        await this.commandEscaper.sendKeysToPane(paneTarget, window.panes[0].command);
      }
    }
  }

  async destroySession(sessionName: string): Promise<void> {
    try {
      this.logger.info(`Destroying tmux session: ${sessionName}`);

      // Stop logging for session
      await this.disableLoggingForSession(sessionName);

      // Kill session
      await this.commandEscaper.executeTmuxCommand('kill-session', ['-t', sessionName]);

      // Clean up pane ID mappings
      this.paneIdResolver.clearSession(sessionName);

      this.logger.info(`Session ${sessionName} destroyed successfully`);
    } catch (error) {
      this.logger.error(`Failed to destroy session ${sessionName}:`, error);
      throw error;
    }
  }

  async listSessions(): Promise<TmuxSession[]> {
    try {
      const result = await this.commandEscaper.executeTmuxCommand('list-sessions', [
        '-F', '#{session_name}|#{session_id}|#{session_created}|#{session_attached}'
      ]);

      const sessions: TmuxSession[] = [];
      const stdout = result.stdout;
      const lines = stdout.trim().split('\n').filter(line => line);

      for (const line of lines) {
        const [name, id, created, attached] = line.split('|');

        const windows = await this.getSessionWindows(name);

        sessions.push({
          name,
          id,
          created: new Date(parseInt(created) * 1000),
          attached: attached === '1',
          windows,
        });
      }

      return sessions;
    } catch (error) {
      // No sessions exist
      if (error instanceof Error && error.message.includes('no server running')) {
        return [];
      }
      throw error;
    }
  }

  async getSession(sessionName: string): Promise<TmuxSession | null> {
    try {
      const sessions = await this.listSessions();
      return sessions.find(s => s.name === sessionName) || null;
    } catch (error) {
      return null;
    }
  }

  private async getSessionWindows(sessionName: string): Promise<TmuxWindow[]> {
    try {
      const result = await this.commandEscaper.executeTmuxCommand('list-windows', [
        '-t', sessionName,
        '-F', '#{window_id}|#{window_name}|#{window_active}'
      ]);

      const windows: TmuxWindow[] = [];
      const stdout = result.stdout;
      const lines = stdout.trim().split('\n').filter(line => line);

      for (const line of lines) {
        const [id, name, active] = line.split('|');

        const panes = await this.getWindowPanes(sessionName, id);

        windows.push({
          id,
          name,
          active: active === '1',
          panes,
        });
      }

      return windows;
    } catch (error) {
      this.logger.error(`Failed to get windows for session ${sessionName}:`, error);
      return [];
    }
  }

  private async getWindowPanes(sessionName: string, windowId: string): Promise<TmuxPane[]> {
    try {
      const result = await this.commandEscaper.executeTmuxCommand('list-panes', [
        '-t', `${sessionName}:${windowId}`,
        '-F', '#{pane_id}|#{pane_index}|#{pane_title}|#{pane_current_command}|#{pane_pid}|#{pane_active}'
      ]);

      const panes: TmuxPane[] = [];
      const stdout = result.stdout;
      const lines = stdout.trim().split('\n').filter(line => line);

      for (const line of lines) {
        const [nativeId, index, title, command, pid, active] = line.split('|');
        const windowIndex = parseInt(windowId.replace('@', ''), 10) || 0;
        const paneIndex = parseInt(index, 10);

        // Register pane ID mapping and get structured ID
        const structuredId = this.paneIdResolver.registerPane(
          nativeId,
          sessionName,
          windowIndex,
          paneIndex
        );

        const logFile = this.options.enableLogging
          ? join(this.options.logDirectory, `${sessionName}_${windowId}_${index}.log`)
          : undefined;

        panes.push({
          id: structuredId, // Use structured ID for API responses
          nativeId, // Keep native ID for internal use
          windowId,
          sessionName,
          index: paneIndex,
          title,
          command,
          pid: parseInt(pid),
          active: active === '1',
          logFile,
        });
      }

      return panes;
    } catch (error) {
      this.logger.error(`Failed to get panes for window ${windowId}:`, error);
      return [];
    }
  }

  async executeCommand(paneId: string, command: string): Promise<void> {
    try {
      this.logger.debug(`Executing command in pane ${paneId}: ${command}`);

      // Resolve pane ID to native format for tmux
      const nativePaneId = this.paneIdResolver.resolveToNative(paneId);

      // Use safe command execution with proper escaping
      await this.commandEscaper.sendKeysToPane(nativePaneId, command);
    } catch (error) {
      this.logger.error(`Failed to execute command in pane ${paneId}:`, error);
      throw error;
    }
  }

  async createPane(sessionName: string, windowIndex: number = 0, command?: string): Promise<TmuxPane> {
    try {
      this.logger.info(`Creating new pane in session ${sessionName}:${windowIndex}`);

      // Split window to create new pane
      await this.commandEscaper.executeTmuxCommand('split-window', [
        '-t', `${sessionName}:${windowIndex}`
      ]);

      // Get the new pane info
      const windows = await this.getSessionWindows(sessionName);
      const window = windows.find(w => w.id.includes(windowIndex.toString()));

      if (!window || window.panes.length === 0) {
        throw new Error('Failed to create pane');
      }

      const newPane = window.panes[window.panes.length - 1];

      // Execute command if provided
      if (command) {
        await this.executeCommand(newPane.id, command);
      }

      // Enable logging for new pane
      if (this.options.enableLogging) {
        await this.enableLoggingForPane(newPane);
      }

      this.logger.info(`Pane created successfully: ${newPane.id}`);
      return newPane;

    } catch (error) {
      this.logger.error(`Failed to create pane:`, error);
      throw error;
    }
  }

  private async enableLoggingForSession(sessionName: string): Promise<void> {
    try {
      const session = await this.getSession(sessionName);
      if (!session) return;

      for (const window of session.windows) {
        for (const pane of window.panes) {
          await this.enableLoggingForPane(pane);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to enable logging for session ${sessionName}:`, error);
    }
  }

  private async enableLoggingForPane(pane: TmuxPane): Promise<void> {
    try {
      if (!pane.logFile) return;

      const logFile = pane.logFile;
      const nativePaneId = this.paneIdResolver.resolveToNative(pane.id);

      await this.commandEscaper.executeTmuxCommand('pipe-pane', [
        '-t', nativePaneId, `cat >> ${logFile}`
      ]);

      this.logger.debug(`Enabled logging for pane ${pane.id} -> ${logFile}`);
    } catch (error) {
      this.logger.error(`Failed to enable logging for pane ${pane.id}:`, error);
    }
  }

  private async disableLoggingForSession(sessionName: string): Promise<void> {
    try {
      const session = await this.getSession(sessionName);
      if (!session) return;

      for (const window of session.windows) {
        for (const pane of window.panes) {
          const nativePaneId = this.paneIdResolver.resolveToNative(pane.id);
          await this.commandEscaper.executeTmuxCommand('pipe-pane', ['-t', nativePaneId]);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to disable logging for session ${sessionName}:`, error);
    }
  }

  async attachSession(sessionName: string): Promise<void> {
    try {
      // This would be used in interactive mode
      spawn('tmux', ['attach-session', '-t', sessionName], {
        stdio: 'inherit'
      });
    } catch (error) {
      this.logger.error(`Failed to attach to session ${sessionName}:`, error);
      throw error;
    }
  }
}