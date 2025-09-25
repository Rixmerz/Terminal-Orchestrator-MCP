/**
 * Tests for SessionStore
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionStore } from '../src/storage/session-store.js';
import { Logger, LogLevel } from '../src/utils/logger.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe('SessionStore', () => {
  let sessionStore: SessionStore;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger(LogLevel.ERROR);
    sessionStore = new SessionStore(logger, {
      storageDirectory: './test-storage',
      maxSessions: 10,
      cleanupInterval: 1000,
      sessionTimeout: 5000,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with empty storage', async () => {
      const { readFile } = await import('fs/promises');
      const readFileMock = vi.mocked(readFile);

      // Mock file not found
      readFileMock.mockRejectedValue(new Error('ENOENT'));

      await expect(sessionStore.initialize()).resolves.not.toThrow();
    });

    it('should load existing sessions', async () => {
      const { readFile } = await import('fs/promises');
      const readFileMock = vi.mocked(readFile);

      const sessionData = {
        'test-session': {
          sessionName: 'test-session',
          config: { name: 'test-session', windows: [] },
          created: '2023-12-01T10:00:00.000Z',
          lastAccessed: '2023-12-01T10:00:00.000Z',
          logDirectory: './logs',
          errorWatchEnabled: false,
          customPatterns: [],
        },
      };

      readFileMock.mockResolvedValue(JSON.stringify(sessionData));

      await sessionStore.initialize();

      const session = await sessionStore.getSession('test-session');
      expect(session).toBeDefined();
      expect(session?.sessionName).toBe('test-session');
    });
  });

  describe('session management', () => {
    beforeEach(async () => {
      const { readFile } = await import('fs/promises');
      const readFileMock = vi.mocked(readFile);
      readFileMock.mockRejectedValue(new Error('ENOENT'));

      await sessionStore.initialize();
    });

    it('should store and retrieve sessions', async () => {
      const config = {
        name: 'test-session',
        windows: [{ name: 'window1', panes: [] }],
      };

      await sessionStore.storeSession('test-session', config, './logs');

      const retrieved = await sessionStore.getSession('test-session');
      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionName).toBe('test-session');
      expect(retrieved?.config.name).toBe('test-session');
    });

    it('should return null for non-existent sessions', async () => {
      const session = await sessionStore.getSession('non-existent');
      expect(session).toBeNull();
    });

    it('should list all sessions', async () => {
      const config1 = { name: 'session1', windows: [] };
      const config2 = { name: 'session2', windows: [] };

      await sessionStore.storeSession('session1', config1, './logs');
      await sessionStore.storeSession('session2', config2, './logs');

      const sessions = await sessionStore.getAllSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.some(s => s.sessionName === 'session1')).toBe(true);
      expect(sessions.some(s => s.sessionName === 'session2')).toBe(true);
    });

    it('should update sessions', async () => {
      const config = { name: 'test-session', windows: [] };
      await sessionStore.storeSession('test-session', config, './logs');

      await sessionStore.updateSession('test-session', {
        errorWatchEnabled: true,
      });

      const updated = await sessionStore.getSession('test-session');
      expect(updated?.errorWatchEnabled).toBe(true);
    });

    it('should remove sessions', async () => {
      const config = { name: 'test-session', windows: [] };
      await sessionStore.storeSession('test-session', config, './logs');

      await sessionStore.removeSession('test-session');

      const removed = await sessionStore.getSession('test-session');
      expect(removed).toBeNull();
    });
  });

  describe('custom patterns', () => {
    beforeEach(async () => {
      const { readFile } = await import('fs/promises');
      const readFileMock = vi.mocked(readFile);
      readFileMock.mockRejectedValue(new Error('ENOENT'));

      await sessionStore.initialize();

      const config = { name: 'test-session', windows: [] };
      await sessionStore.storeSession('test-session', config, './logs');
    });

    it('should add custom patterns', async () => {
      await sessionStore.addCustomPattern('test-session', 'custom-pattern');

      const session = await sessionStore.getSession('test-session');
      expect(session?.customPatterns).toContain('custom-pattern');
    });

    it('should remove custom patterns', async () => {
      await sessionStore.addCustomPattern('test-session', 'temp-pattern');
      await sessionStore.removeCustomPattern('test-session', 'temp-pattern');

      const session = await sessionStore.getSession('test-session');
      expect(session?.customPatterns).not.toContain('temp-pattern');
    });

    it('should not add duplicate patterns', async () => {
      await sessionStore.addCustomPattern('test-session', 'unique-pattern');
      await sessionStore.addCustomPattern('test-session', 'unique-pattern');

      const session = await sessionStore.getSession('test-session');
      const count = session?.customPatterns.filter(p => p === 'unique-pattern').length;
      expect(count).toBe(1);
    });
  });

  describe('statistics', () => {
    beforeEach(async () => {
      const { readFile } = await import('fs/promises');
      const readFileMock = vi.mocked(readFile);
      readFileMock.mockRejectedValue(new Error('ENOENT'));

      await sessionStore.initialize();
    });

    it('should provide session statistics', async () => {
      const config = { name: 'test-session', windows: [] };
      await sessionStore.storeSession('test-session', config, './logs');

      const stats = await sessionStore.getSessionStats();
      expect(stats.totalSessions).toBe(1);
      expect(stats.activeSessions).toBe(1);
      expect(stats.errorWatchingSessions).toBe(0);
    });

    it('should track error watching sessions', async () => {
      const config = { name: 'test-session', windows: [] };
      await sessionStore.storeSession('test-session', config, './logs');
      await sessionStore.setErrorWatchEnabled('test-session', true);

      const stats = await sessionStore.getSessionStats();
      expect(stats.errorWatchingSessions).toBe(1);
    });
  });
});