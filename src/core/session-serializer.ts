/**
 * SessionSerializer - Save and restore complete tmux session state
 *
 * Provides persistence and recovery capabilities for sessions across restarts
 */

import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { join } from 'path';
import type {
  TmuxSession,
  TmuxPane,
  TmuxWindow,
  SessionConfig,
} from '../types/index.js';
import type { Logger } from '../utils/logger.js';

export interface SerializedSession {
  /** Basic session info */
  name: string;
  id: string;
  created: Date;
  attached: boolean;

  /** Working directory for session */
  workingDirectory: string;

  /** Environment variables */
  environment: Record<string, string>;

  /** Window configurations */
  windows: SerializedWindow[];

  /** Metadata */
  serializedAt: Date;
  mcpServerVersion?: string;
}

export interface SerializedWindow {
  name: string;
  id: string;
  active: boolean;
  index: number;
  panes: SerializedPane[];
}

export interface SerializedPane {
  id: string;
  nativeId?: string;
  index: number;
  title: string;
  command: string;
  workingDirectory?: string;
  active: boolean;

  /** Command history for recovery */
  commandHistory: string[];

  /** Framework detection results */
  detectedFrameworks?: string[];

  /** Last known state */
  lastOutput?: string;
}

export interface SessionTemplate {
  name: string;
  description: string;
  framework: string;
  config: SessionConfig;
  tags: string[];
}

export class SessionSerializer {
  private storageDir: string;
  private templatesFile: string;

  constructor(
    private logger: Logger,
    storageDirectory: string = './storage'
  ) {
    this.storageDir = storageDirectory;
    this.templatesFile = join(storageDirectory, 'session-templates.json');
  }

  async initialize(): Promise<void> {
    try {
      // Ensure storage directory exists
      await mkdir(this.storageDir, { recursive: true });

      // Initialize templates file if it doesn't exist
      try {
        await access(this.templatesFile);
      } catch {
        await this.initializeTemplates();
      }

      this.logger.info('SessionSerializer initialized');
    } catch (error) {
      this.logger.error('Failed to initialize SessionSerializer:', error);
      throw error;
    }
  }

  /**
   * Serialize a session to persistent storage
   */
  async serializeSession(
    session: TmuxSession,
    workingDirectory?: string,
    environment?: Record<string, string>
  ): Promise<void> {
    try {
      const serialized: SerializedSession = {
        name: session.name,
        id: session.id,
        created: session.created,
        attached: session.attached,
        workingDirectory: workingDirectory || process.cwd(),
        environment: environment || {},
        windows: session.windows.map((window, windowIndex) => ({
          name: window.name,
          id: window.id,
          active: window.active,
          index: windowIndex,
          panes: window.panes.map(pane => ({
            id: pane.id,
            nativeId: pane.nativeId,
            index: pane.index,
            title: pane.title,
            command: pane.command,
            active: pane.active,
            commandHistory: this.extractCommandHistory(pane),
            detectedFrameworks: [], // Will be populated by framework detector
          })),
        })),
        serializedAt: new Date(),
        mcpServerVersion: this.getServerVersion(),
      };

      const filePath = join(this.storageDir, `session-${session.name}.json`);
      await writeFile(filePath, JSON.stringify(serialized, null, 2), 'utf-8');

      this.logger.info(`Session ${session.name} serialized to ${filePath}`);
    } catch (error) {
      this.logger.error(`Failed to serialize session ${session.name}:`, error);
      throw error;
    }
  }

  /**
   * Deserialize a session from storage
   */
  async deserializeSession(sessionName: string): Promise<SerializedSession | null> {
    try {
      const filePath = join(this.storageDir, `session-${sessionName}.json`);
      const content = await readFile(filePath, 'utf-8');
      const serialized: SerializedSession = JSON.parse(content);

      // Convert date strings back to Date objects
      serialized.created = new Date(serialized.created);
      serialized.serializedAt = new Date(serialized.serializedAt);

      this.logger.info(`Session ${sessionName} deserialized from ${filePath}`);
      return serialized;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        this.logger.debug(`No serialized session found for: ${sessionName}`);
        return null;
      }
      this.logger.error(`Failed to deserialize session ${sessionName}:`, error);
      throw error;
    }
  }

  /**
   * Convert serialized session to session config for recreation
   */
  sessionToConfig(serialized: SerializedSession): SessionConfig {
    return {
      name: serialized.name,
      workingDirectory: serialized.workingDirectory,
      environment: serialized.environment,
      windows: serialized.windows.map(window => ({
        name: window.name,
        panes: window.panes.map(pane => ({
          command: pane.command,
          workingDirectory: pane.workingDirectory,
        })),
      })),
    };
  }

  /**
   * Get all serialized sessions
   */
  async listSerializedSessions(): Promise<string[]> {
    try {
      const { readdir } = await import('fs/promises');
      const files = await readdir(this.storageDir);

      return files
        .filter(file => file.startsWith('session-') && file.endsWith('.json'))
        .map(file => file.slice(8, -5)); // Remove 'session-' prefix and '.json' suffix
    } catch (error) {
      this.logger.error('Failed to list serialized sessions:', error);
      return [];
    }
  }

  /**
   * Delete a serialized session
   */
  async deleteSerializedSession(sessionName: string): Promise<void> {
    try {
      const filePath = join(this.storageDir, `session-${sessionName}.json`);
      const { unlink } = await import('fs/promises');
      await unlink(filePath);

      this.logger.info(`Deleted serialized session: ${sessionName}`);
    } catch (error) {
      this.logger.error(`Failed to delete serialized session ${sessionName}:`, error);
      throw error;
    }
  }

  /**
   * Save a session template
   */
  async saveTemplate(template: SessionTemplate): Promise<void> {
    try {
      const templates = await this.loadTemplates();

      // Remove existing template with same name
      const filtered = templates.filter(t => t.name !== template.name);
      filtered.push(template);

      await writeFile(this.templatesFile, JSON.stringify(filtered, null, 2), 'utf-8');

      this.logger.info(`Saved session template: ${template.name}`);
    } catch (error) {
      this.logger.error(`Failed to save template ${template.name}:`, error);
      throw error;
    }
  }

  /**
   * Load all session templates
   */
  async loadTemplates(): Promise<SessionTemplate[]> {
    try {
      const content = await readFile(this.templatesFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return [];
      }
      this.logger.error('Failed to load session templates:', error);
      throw error;
    }
  }

  /**
   * Get template by name
   */
  async getTemplate(name: string): Promise<SessionTemplate | null> {
    const templates = await this.loadTemplates();
    return templates.find(t => t.name === name) || null;
  }

  /**
   * Get templates by framework
   */
  async getTemplatesByFramework(framework: string): Promise<SessionTemplate[]> {
    const templates = await this.loadTemplates();
    return templates.filter(t => t.framework === framework);
  }

  /**
   * Create session handoff data for agent transfers
   */
  async createSessionHandoff(sessionName: string): Promise<{
    session: SerializedSession;
    handoffId: string;
    createdAt: Date;
    expiresAt: Date;
  }> {
    const session = await this.deserializeSession(sessionName);
    if (!session) {
      throw new Error(`Session ${sessionName} not found for handoff`);
    }

    const handoffId = `handoff-${sessionName}-${Date.now()}`;
    const handoffData = {
      session,
      handoffId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
    };

    const handoffPath = join(this.storageDir, `${handoffId}.json`);
    await writeFile(handoffPath, JSON.stringify(handoffData, null, 2), 'utf-8');

    this.logger.info(`Created session handoff: ${handoffId}`);
    return handoffData;
  }

  /**
   * Accept a session handoff
   */
  async acceptSessionHandoff(handoffId: string): Promise<SerializedSession | null> {
    try {
      const handoffPath = join(this.storageDir, `${handoffId}.json`);
      const content = await readFile(handoffPath, 'utf-8');
      const handoffData = JSON.parse(content);

      // Check if handoff is expired
      const expiresAt = new Date(handoffData.expiresAt);
      if (new Date() > expiresAt) {
        throw new Error(`Session handoff ${handoffId} has expired`);
      }

      // Clean up handoff file
      const { unlink } = await import('fs/promises');
      await unlink(handoffPath).catch(() => {}); // Ignore errors

      this.logger.info(`Accepted session handoff: ${handoffId}`);
      return handoffData.session;
    } catch (error) {
      this.logger.error(`Failed to accept session handoff ${handoffId}:`, error);
      return null;
    }
  }

  /**
   * Extract command history from a pane (placeholder implementation)
   */
  private extractCommandHistory(pane: TmuxPane): string[] {
    // In a real implementation, this would read from log files
    // or maintain command history tracking
    return pane.command ? [pane.command] : [];
  }

  /**
   * Get server version for compatibility tracking
   */
  private getServerVersion(): string {
    // This would typically come from package.json or build info
    return '1.0.0';
  }

  /**
   * Initialize default session templates
   */
  private async initializeTemplates(): Promise<void> {
    const defaultTemplates: SessionTemplate[] = [
      {
        name: 'Node.js Development',
        description: 'Standard Node.js development environment with npm/yarn',
        framework: 'node',
        config: {
          name: 'node-dev',
          windows: [
            {
              name: 'main',
              panes: [
                { command: 'npm run dev' },
              ],
            },
            {
              name: 'test',
              panes: [
                { command: 'npm test -- --watch' },
              ],
            },
            {
              name: 'terminal',
              panes: [
                {}, // Just a terminal
              ],
            },
          ],
        },
        tags: ['nodejs', 'javascript', 'development'],
      },
      {
        name: 'React Development',
        description: 'React development environment with dev server and testing',
        framework: 'react',
        config: {
          name: 'react-dev',
          windows: [
            {
              name: 'server',
              panes: [
                { command: 'npm start' },
              ],
            },
            {
              name: 'test',
              panes: [
                { command: 'npm test' },
              ],
            },
            {
              name: 'build',
              panes: [
                { command: 'npm run build' },
              ],
            },
          ],
        },
        tags: ['react', 'frontend', 'development'],
      },
      {
        name: 'Python Development',
        description: 'Python development with virtual environment',
        framework: 'python',
        config: {
          name: 'python-dev',
          windows: [
            {
              name: 'main',
              panes: [
                { command: 'python -m venv venv && source venv/bin/activate' },
              ],
            },
            {
              name: 'test',
              panes: [
                { command: 'source venv/bin/activate && pytest --watch' },
              ],
            },
          ],
        },
        tags: ['python', 'development'],
      },
    ];

    await writeFile(this.templatesFile, JSON.stringify(defaultTemplates, null, 2), 'utf-8');
    this.logger.info('Initialized default session templates');
  }
}