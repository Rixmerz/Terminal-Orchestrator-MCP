/**
 * Error Watcher - Real-time error detection and monitoring
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type {
  ErrorEntry,
  ErrorPattern,
  TmuxPane,
  WatcherOptions
} from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { FileWatcher } from '../utils/file-watcher.js';

export interface ErrorWatcherEvents {
  error: (error: ErrorEntry) => void;
  warning: (warning: ErrorEntry) => void;
  clear: () => void;
}

export declare interface ErrorWatcher {
  on<U extends keyof ErrorWatcherEvents>(
    event: U, listener: ErrorWatcherEvents[U]
  ): this;
  emit<U extends keyof ErrorWatcherEvents>(
    event: U, ...args: Parameters<ErrorWatcherEvents[U]>
  ): boolean;
}

export class ErrorWatcher extends EventEmitter {
  private fileWatcher: FileWatcher;
  private buildWatchers: Map<string, ChildProcess> = new Map();
  private errorCache: Map<string, ErrorEntry[]> = new Map();
  private watchedPanes: Set<string> = new Set();

  private buildCommands = {
    typescript: 'tsc --watch --noEmit',
    javascript: 'eslint --cache --watch',
    rust: 'cargo check --watch',
    go: 'go build -watch',
    python: 'python -m py_compile',
    java: 'javac -Xlint:all',
  };

  private errorPatterns: ErrorPattern[] = [
    {
      name: 'typescript_watch',
      regex: /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*TS\d+:\s*(.+)$/,
      type: 'error',
      language: 'typescript',
      captureGroups: {
        file: 1,
        line: 2,
        column: 3,
        message: 5,
      },
    },
    {
      name: 'rust_watch',
      regex: /^error.*?:\s*(.+)\n.*?--> (.+?):(\d+):(\d+)/s,
      type: 'error',
      language: 'rust',
      captureGroups: {
        file: 2,
        line: 3,
        column: 4,
        message: 1,
      },
    },
    {
      name: 'go_watch',
      regex: /^(.+?):(\d+):(\d+):\s*(.+)$/,
      type: 'error',
      language: 'go',
      captureGroups: {
        file: 1,
        line: 2,
        column: 3,
        message: 4,
      },
    },
    {
      name: 'eslint_watch',
      regex: /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(.+)$/,
      type: 'error',
      language: 'javascript',
      captureGroups: {
        line: 1,
        column: 2,
        message: 4,
      },
    },
  ];

  constructor(
    private logger: Logger,
    private options: WatcherOptions = {
      debounceMs: 500,
      maxFileSize: 50 * 1024 * 1024, // 50MB
      excludePatterns: ['node_modules/**', '.git/**', 'dist/**'],
    }
  ) {
    super();
    this.fileWatcher = new FileWatcher(logger, options);
  }

  async startWatching(pane: TmuxPane): Promise<void> {
    try {
      this.logger.info(`Starting error watching for pane: ${pane.id}`);

      if (this.watchedPanes.has(pane.id)) {
        this.logger.warn(`Pane ${pane.id} is already being watched`);
        return;
      }

      this.watchedPanes.add(pane.id);

      // Watch log file for real-time errors
      if (pane.logFile) {
        await this.fileWatcher.watchFile(pane.logFile, (content) => {
          this.processLogContent(content, pane.id);
        });
      }

      // Start language-specific build watchers
      await this.startBuildWatcher(pane);

      this.logger.info(`Error watching started for pane: ${pane.id}`);

    } catch (error) {
      this.logger.error(`Failed to start watching pane ${pane.id}:`, error);
      throw error;
    }
  }

  async stopWatching(paneId: string): Promise<void> {
    try {
      this.logger.info(`Stopping error watching for pane: ${paneId}`);

      this.watchedPanes.delete(paneId);

      // Stop build watcher
      const buildWatcher = this.buildWatchers.get(paneId);
      if (buildWatcher) {
        buildWatcher.kill();
        this.buildWatchers.delete(paneId);
      }

      // Clear error cache
      this.errorCache.delete(paneId);

      this.logger.info(`Error watching stopped for pane: ${paneId}`);

    } catch (error) {
      this.logger.error(`Failed to stop watching pane ${paneId}:`, error);
    }
  }

  private async startBuildWatcher(pane: TmuxPane): Promise<void> {
    try {
      // Detect language/framework from pane command
      const language = this.detectLanguage(pane.command);
      if (!language) {
        this.logger.debug(`No specific language detected for pane ${pane.id}`);
        return;
      }

      const command = this.buildCommands[language as keyof typeof this.buildCommands];
      if (!command) {
        this.logger.debug(`No build command available for language: ${language}`);
        return;
      }

      this.logger.debug(`Starting ${language} build watcher for pane ${pane.id}`);

      const [cmd, ...args] = command.split(' ');
      const buildProcess = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      // Process stdout
      buildProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        this.processBuildOutput(output, pane.id, language);
      });

      // Process stderr
      buildProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        this.processBuildOutput(output, pane.id, language);
      });

      buildProcess.on('error', (error) => {
        this.logger.error(`Build watcher error for pane ${pane.id}:`, error);
      });

      buildProcess.on('exit', (code) => {
        this.logger.debug(`Build watcher exited for pane ${pane.id} with code ${code}`);
        this.buildWatchers.delete(pane.id);
      });

      this.buildWatchers.set(pane.id, buildProcess);

    } catch (error) {
      this.logger.error(`Failed to start build watcher for pane ${pane.id}:`, error);
    }
  }

  private detectLanguage(command: string): string | null {
    const commands = command.toLowerCase();

    if (commands.includes('tsc') || commands.includes('typescript')) return 'typescript';
    if (commands.includes('cargo') || commands.includes('rust')) return 'rust';
    if (commands.includes('go ') || commands.includes('golang')) return 'go';
    if (commands.includes('python') || commands.includes('py')) return 'python';
    if (commands.includes('java') || commands.includes('javac')) return 'java';
    if (commands.includes('node') || commands.includes('npm') || commands.includes('yarn')) return 'javascript';

    return null;
  }

  private processLogContent(content: string, paneId: string): void {
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const errorEntry = this.matchErrorPatterns(line, paneId);
      if (errorEntry) {
        this.addError(errorEntry);

        if (errorEntry.type === 'error') {
          this.emit('error', errorEntry);
        } else if (errorEntry.type === 'warning') {
          this.emit('warning', errorEntry);
        }
      }
    }
  }

  private processBuildOutput(output: string, paneId: string, language: string): void {
    const lines = output.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const errorEntry = this.matchErrorPatterns(line, paneId, language);
      if (errorEntry) {
        this.addError(errorEntry);

        if (errorEntry.type === 'error') {
          this.emit('error', errorEntry);
        } else if (errorEntry.type === 'warning') {
          this.emit('warning', errorEntry);
        }
      }
    }
  }

  private matchErrorPatterns(line: string, paneId: string, language?: string): ErrorEntry | null {
    for (const pattern of this.errorPatterns) {
      // Filter by language if specified
      if (language && pattern.language && pattern.language !== language) {
        continue;
      }

      const match = line.match(pattern.regex);
      if (match) {
        const groups = pattern.captureGroups;

        return {
          id: `${paneId}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`,
          paneId,
          file: groups.file ? match[groups.file] : undefined,
          line: groups.line ? parseInt(match[groups.line]) : undefined,
          column: groups.column ? parseInt(match[groups.column]) : undefined,
          message: match[groups.message] || line,
          type: pattern.type,
          language: pattern.language || language,
          timestamp: new Date(),
        };
      }
    }

    return null;
  }

  private addError(error: ErrorEntry): void {
    if (!this.errorCache.has(error.paneId)) {
      this.errorCache.set(error.paneId, []);
    }

    const errors = this.errorCache.get(error.paneId)!;
    errors.push(error);

    // Keep only last 100 errors per pane
    if (errors.length > 100) {
      errors.splice(0, errors.length - 100);
    }
  }

  getErrors(paneId: string): ErrorEntry[] {
    return this.errorCache.get(paneId) || [];
  }

  getAllErrors(): Map<string, ErrorEntry[]> {
    return new Map(this.errorCache);
  }

  clearErrors(paneId?: string): void {
    if (paneId) {
      this.errorCache.delete(paneId);
      this.logger.debug(`Cleared errors for pane: ${paneId}`);
    } else {
      this.errorCache.clear();
      this.logger.debug('Cleared all errors');
      this.emit('clear');
    }
  }

  getErrorSummary(paneId?: string): { total: number; errors: number; warnings: number } {
    let total = 0;
    let errors = 0;
    let warnings = 0;

    const cacheToAnalyze = paneId
      ? new Map([[paneId, this.errorCache.get(paneId) || []]])
      : this.errorCache;

    for (const [, errorList] of cacheToAnalyze) {
      for (const error of errorList) {
        total++;
        if (error.type === 'error') errors++;
        if (error.type === 'warning') warnings++;
      }
    }

    return { total, errors, warnings };
  }

  addCustomPattern(pattern: ErrorPattern): void {
    this.errorPatterns.push(pattern);
    this.logger.debug(`Added custom error pattern: ${pattern.name}`);
  }

  removePattern(name: string): void {
    const index = this.errorPatterns.findIndex(p => p.name === name);
    if (index !== -1) {
      this.errorPatterns.splice(index, 1);
      this.logger.debug(`Removed error pattern: ${name}`);
    }
  }

  getWatchedPanes(): string[] {
    return Array.from(this.watchedPanes);
  }

  async analyzeErrors(paneId: string): Promise<{
    recentErrors: ErrorEntry[];
    topFiles: Array<{ file: string; count: number }>;
    errorTypes: Array<{ type: string; count: number }>;
    trends: {
      lastHour: number;
      lastDay: number;
    };
  }> {
    const errors = this.getErrors(paneId);
    const now = new Date();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;

    // Recent errors (last 10)
    const recentErrors = errors.slice(-10);

    // Count by file
    const fileCount = new Map<string, number>();
    errors.forEach(error => {
      if (error.file) {
        fileCount.set(error.file, (fileCount.get(error.file) || 0) + 1);
      }
    });

    const topFiles = Array.from(fileCount.entries())
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Count by type
    const typeCount = new Map<string, number>();
    errors.forEach(error => {
      typeCount.set(error.type, (typeCount.get(error.type) || 0) + 1);
    });

    const errorTypes = Array.from(typeCount.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // Trends
    const lastHour = errors.filter(
      error => now.getTime() - error.timestamp.getTime() < oneHour
    ).length;

    const lastDay = errors.filter(
      error => now.getTime() - error.timestamp.getTime() < oneDay
    ).length;

    return {
      recentErrors,
      topFiles,
      errorTypes,
      trends: { lastHour, lastDay },
    };
  }

  destroy(): void {
    this.logger.info('Destroying ErrorWatcher');

    // Stop all build watchers
    for (const [paneId, watcher] of this.buildWatchers) {
      watcher.kill();
    }
    this.buildWatchers.clear();

    // Stop file watcher
    this.fileWatcher.stopAll();

    // Clear caches
    this.errorCache.clear();
    this.watchedPanes.clear();

    this.removeAllListeners();
  }
}