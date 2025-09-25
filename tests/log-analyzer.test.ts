/**
 * Tests for LogAnalyzer
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LogAnalyzer } from '../src/core/log-analyzer.js';
import { Logger, LogLevel } from '../src/utils/logger.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

// Mock readline
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));

describe('LogAnalyzer', () => {
  let logAnalyzer: LogAnalyzer;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger(LogLevel.ERROR);
    logAnalyzer = new LogAnalyzer(logger);
  });

  describe('pattern matching', () => {
    it('should detect TypeScript errors', () => {
      const logLine = 'src/index.ts(42,10): error TS2339: Property \'foo\' does not exist on type \'string\'.';

      // Access private method for testing
      const matchErrorPatterns = (logAnalyzer as any).matchErrorPatterns;
      const result = matchErrorPatterns.call(logAnalyzer, logLine, '/test/log.txt', 1);

      expect(result).toBeDefined();
      expect(result?.type).toBe('error');
      expect(result?.language).toBe('typescript');
      expect(result?.file).toBe('src/index.ts');
      expect(result?.line).toBe(42);
      expect(result?.column).toBe(10);
    });

    it('should detect general errors', () => {
      const logLine = 'ERROR: Something went wrong!';

      const matchErrorPatterns = (logAnalyzer as any).matchErrorPatterns;
      const result = matchErrorPatterns.call(logAnalyzer, logLine, '/test/log.txt', 1);

      expect(result).toBeDefined();
      expect(result?.type).toBe('error');
      expect(result?.message).toContain('ERROR: Something went wrong!');
    });

    it('should detect warnings', () => {
      const logLine = 'WARNING: This is deprecated';

      const matchErrorPatterns = (logAnalyzer as any).matchErrorPatterns;
      const result = matchErrorPatterns.call(logAnalyzer, logLine, '/test/log.txt', 1);

      expect(result).toBeDefined();
      expect(result?.type).toBe('warning');
    });

    it('should return null for non-matching lines', () => {
      const logLine = 'This is just a normal log line';

      const matchErrorPatterns = (logAnalyzer as any).matchErrorPatterns;
      const result = matchErrorPatterns.call(logAnalyzer, logLine, '/test/log.txt', 1);

      expect(result).toBeNull();
    });
  });

  describe('custom patterns', () => {
    it('should add custom patterns', () => {
      const customPattern = {
        name: 'custom-error',
        regex: /CUSTOM_ERROR:\s*(.+)/,
        type: 'error' as const,
        captureGroups: {
          message: 1,
        },
      };

      logAnalyzer.addCustomPattern(customPattern);

      const patterns = logAnalyzer.getPatterns();
      expect(patterns.some(p => p.name === 'custom-error')).toBe(true);
    });

    it('should remove patterns', () => {
      const customPattern = {
        name: 'temp-pattern',
        regex: /TEMP:\s*(.+)/,
        type: 'warning' as const,
        captureGroups: {
          message: 1,
        },
      };

      logAnalyzer.addCustomPattern(customPattern);
      logAnalyzer.removePattern('temp-pattern');

      const patterns = logAnalyzer.getPatterns();
      expect(patterns.some(p => p.name === 'temp-pattern')).toBe(false);
    });
  });

  describe('timestamp extraction', () => {
    it('should extract ISO timestamps', () => {
      const logLine = '[2023-12-01T10:30:45.123Z] Info: Application started';

      const extractTimestamp = (logAnalyzer as any).extractTimestamp;
      const result = extractTimestamp.call(logAnalyzer, logLine);

      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(2023);
    });

    it('should extract simple time stamps', () => {
      const logLine = '[10:30:45] Debug: Processing request';

      const extractTimestamp = (logAnalyzer as any).extractTimestamp;
      const result = extractTimestamp.call(logAnalyzer, logLine);

      expect(result).toBeInstanceOf(Date);
    });

    it('should return null for lines without timestamps', () => {
      const logLine = 'No timestamp here';

      const extractTimestamp = (logAnalyzer as any).extractTimestamp;
      const result = extractTimestamp.call(logAnalyzer, logLine);

      expect(result).toBeNull();
    });
  });
});