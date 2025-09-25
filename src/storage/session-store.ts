/**
 * Session Store - Persistent storage for tmux session metadata
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import type { TmuxSession, SessionConfig } from '../types/index.js';
import type { Logger } from '../utils/logger.js';

export interface SessionMetadata {
  sessionName: string;
  config: SessionConfig;
  created: Date;
  lastAccessed: Date;
  logDirectory: string;
  errorWatchEnabled: boolean;
  customPatterns: string[];
}

export interface StorageConfig {
  storageDirectory: string;
  maxSessions: number;
  cleanupInterval: number; // in ms
  sessionTimeout: number; // in ms
}

export class SessionStore {
  private storageDir: string;
  private sessionsFile: string;
  private sessions: Map<string, SessionMetadata> = new Map();

  constructor(
    private logger: Logger,
    private config: StorageConfig = {
      storageDirectory: './storage',
      maxSessions: 50,
      cleanupInterval: 30 * 60 * 1000, // 30 minutes
      sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
    }
  ) {
    this.storageDir = config.storageDirectory;
    this.sessionsFile = join(this.storageDir, 'sessions.json');
  }

  async initialize(): Promise<void> {
    try {
      // Create storage directory if it doesn't exist
      await mkdir(this.storageDir, { recursive: true });

      // Load existing sessions
      await this.loadSessions();

      // Start cleanup interval
      this.startCleanupInterval();

      this.logger.info('SessionStore initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize SessionStore:', error);
      throw error;
    }
  }

  private async loadSessions(): Promise<void> {
    try {
      await access(this.sessionsFile);
      const data = await readFile(this.sessionsFile, 'utf8');
      const sessionsData = JSON.parse(data);

      this.sessions.clear();
      for (const [sessionName, metadata] of Object.entries(sessionsData)) {
        const typedMetadata = metadata as any;
        this.sessions.set(sessionName, {
          ...typedMetadata,
          created: new Date(typedMetadata.created),
          lastAccessed: new Date(typedMetadata.lastAccessed),
        });
      }

      this.logger.debug(`Loaded ${this.sessions.size} sessions from storage`);
    } catch (error) {
      // File doesn't exist or is invalid, start with empty sessions
      this.sessions.clear();
      this.logger.debug('No existing sessions file found, starting fresh');
    }
  }

  private async saveSessions(): Promise<void> {
    try {
      const sessionsData: Record<string, any> = {};
      for (const [sessionName, metadata] of this.sessions) {
        sessionsData[sessionName] = metadata;
      }

      await writeFile(this.sessionsFile, JSON.stringify(sessionsData, null, 2), 'utf8');
      this.logger.debug('Sessions saved to storage');
    } catch (error) {
      this.logger.error('Failed to save sessions:', error);
    }
  }

  async storeSession(sessionName: string, config: SessionConfig, logDirectory: string): Promise<void> {
    try {
      const metadata: SessionMetadata = {
        sessionName,
        config,
        created: new Date(),
        lastAccessed: new Date(),
        logDirectory,
        errorWatchEnabled: false,
        customPatterns: [],
      };

      this.sessions.set(sessionName, metadata);
      await this.saveSessions();

      this.logger.debug(`Stored session metadata: ${sessionName}`);
    } catch (error) {
      this.logger.error(`Failed to store session ${sessionName}:`, error);
      throw error;
    }
  }

  async getSession(sessionName: string): Promise<SessionMetadata | null> {
    const metadata = this.sessions.get(sessionName);
    if (metadata) {
      // Update last accessed time
      metadata.lastAccessed = new Date();
      await this.saveSessions();
    }
    return metadata || null;
  }

  async getAllSessions(): Promise<SessionMetadata[]> {
    return Array.from(this.sessions.values());
  }

  async updateSession(sessionName: string, updates: Partial<SessionMetadata>): Promise<void> {
    const existing = this.sessions.get(sessionName);
    if (!existing) {
      throw new Error(`Session ${sessionName} not found in storage`);
    }

    const updated = {
      ...existing,
      ...updates,
      lastAccessed: new Date(),
    };

    this.sessions.set(sessionName, updated);
    await this.saveSessions();

    this.logger.debug(`Updated session metadata: ${sessionName}`);
  }

  async removeSession(sessionName: string): Promise<void> {
    const removed = this.sessions.delete(sessionName);
    if (removed) {
      await this.saveSessions();
      this.logger.debug(`Removed session from storage: ${sessionName}`);
    }
  }

  async setErrorWatchEnabled(sessionName: string, enabled: boolean): Promise<void> {
    await this.updateSession(sessionName, { errorWatchEnabled: enabled });
  }

  async addCustomPattern(sessionName: string, patternName: string): Promise<void> {
    const session = this.sessions.get(sessionName);
    if (session) {
      if (!session.customPatterns.includes(patternName)) {
        session.customPatterns.push(patternName);
        await this.updateSession(sessionName, { customPatterns: session.customPatterns });
      }
    }
  }

  async removeCustomPattern(sessionName: string, patternName: string): Promise<void> {
    const session = this.sessions.get(sessionName);
    if (session) {
      const index = session.customPatterns.indexOf(patternName);
      if (index !== -1) {
        session.customPatterns.splice(index, 1);
        await this.updateSession(sessionName, { customPatterns: session.customPatterns });
      }
    }
  }

  async getSessionStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    oldestSession: Date | null;
    newestSession: Date | null;
    errorWatchingSessions: number;
  }> {
    const sessions = Array.from(this.sessions.values());

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s =>
        Date.now() - s.lastAccessed.getTime() < this.config.sessionTimeout
      ).length,
      oldestSession: sessions.length > 0
        ? new Date(Math.min(...sessions.map(s => s.created.getTime())))
        : null,
      newestSession: sessions.length > 0
        ? new Date(Math.max(...sessions.map(s => s.created.getTime())))
        : null,
      errorWatchingSessions: sessions.filter(s => s.errorWatchEnabled).length,
    };
  }

  async restoreSession(sessionName: string): Promise<SessionConfig | null> {
    const metadata = await this.getSession(sessionName);
    if (metadata) {
      this.logger.info(`Restoring session configuration: ${sessionName}`);
      return metadata.config;
    }
    return null;
  }

  async exportSessionConfigs(): Promise<Record<string, SessionConfig>> {
    const configs: Record<string, SessionConfig> = {};
    for (const [sessionName, metadata] of this.sessions) {
      configs[sessionName] = metadata.config;
    }
    return configs;
  }

  async importSessionConfigs(configs: Record<string, SessionConfig>): Promise<void> {
    try {
      for (const [sessionName, config] of Object.entries(configs)) {
        if (!this.sessions.has(sessionName)) {
          await this.storeSession(sessionName, config, './logs');
        }
      }
      this.logger.info(`Imported ${Object.keys(configs).length} session configurations`);
    } catch (error) {
      this.logger.error('Failed to import session configurations:', error);
      throw error;
    }
  }

  private startCleanupInterval(): void {
    setInterval(async () => {
      await this.cleanupOldSessions();
    }, this.config.cleanupInterval);

    this.logger.debug(`Started cleanup interval: ${this.config.cleanupInterval}ms`);
  }

  private async cleanupOldSessions(): Promise<void> {
    try {
      const now = Date.now();
      let removedCount = 0;

      for (const [sessionName, metadata] of this.sessions) {
        const timeSinceAccess = now - metadata.lastAccessed.getTime();

        if (timeSinceAccess > this.config.sessionTimeout) {
          this.sessions.delete(sessionName);
          removedCount++;
          this.logger.debug(`Cleaned up old session: ${sessionName}`);
        }
      }

      // If we have too many sessions, remove the oldest ones
      if (this.sessions.size > this.config.maxSessions) {
        const sortedSessions = Array.from(this.sessions.entries())
          .sort((a, b) => a[1].lastAccessed.getTime() - b[1].lastAccessed.getTime());

        const toRemove = this.sessions.size - this.config.maxSessions;
        for (let i = 0; i < toRemove; i++) {
          const [sessionName] = sortedSessions[i];
          this.sessions.delete(sessionName);
          removedCount++;
          this.logger.debug(`Removed excess session: ${sessionName}`);
        }
      }

      if (removedCount > 0) {
        await this.saveSessions();
        this.logger.info(`Cleanup completed: removed ${removedCount} sessions`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup old sessions:', error);
    }
  }

  async backup(): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = join(this.storageDir, `sessions-backup-${timestamp}.json`);

      const data = await readFile(this.sessionsFile, 'utf8');
      await writeFile(backupFile, data, 'utf8');

      this.logger.info(`Sessions backed up to: ${backupFile}`);
      return backupFile;
    } catch (error) {
      this.logger.error('Failed to backup sessions:', error);
      throw error;
    }
  }

  async restore(backupFile: string): Promise<void> {
    try {
      const data = await readFile(backupFile, 'utf8');
      await writeFile(this.sessionsFile, data, 'utf8');
      await this.loadSessions();

      this.logger.info(`Sessions restored from: ${backupFile}`);
    } catch (error) {
      this.logger.error('Failed to restore sessions:', error);
      throw error;
    }
  }

  async destroy(): Promise<void> {
    try {
      await this.saveSessions();
      this.sessions.clear();
      this.logger.info('SessionStore destroyed');
    } catch (error) {
      this.logger.error('Failed to destroy SessionStore:', error);
    }
  }
}