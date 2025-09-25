/**
 * File watcher utility for real-time log monitoring
 */

import { watch, FSWatcher } from 'chokidar';
import { readFile } from 'fs/promises';
import { stat } from 'fs/promises';
import type { Logger } from './logger.js';
import type { WatcherOptions } from '../types/index.js';

export class FileWatcher {
  private watchers: Map<string, FSWatcher> = new Map();
  private filePositions: Map<string, number> = new Map();
  private callbacks: Map<string, (content: string) => void> = new Map();

  constructor(
    private logger: Logger,
    private options: WatcherOptions = {
      debounceMs: 100,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      excludePatterns: ['*.tmp', '*.swp'],
    }
  ) {}

  async watchFile(
    filePath: string,
    callback: (content: string) => void
  ): Promise<void> {
    try {
      // Check if file exists and get initial position
      const stats = await stat(filePath);
      if (stats.size > this.options.maxFileSize) {
        this.logger.warn(`File ${filePath} exceeds max size, watching from end`);
        this.filePositions.set(filePath, stats.size);
      } else {
        this.filePositions.set(filePath, 0);
      }

      // Store callback
      this.callbacks.set(filePath, callback);

      // Create watcher
      const watcher = watch(filePath, {
        persistent: true,
        ignoreInitial: false,
      });

      watcher.on('change', async () => {
        await this.handleFileChange(filePath);
      });

      watcher.on('error', (error) => {
        this.logger.error(`Watcher error for ${filePath}:`, error);
      });

      this.watchers.set(filePath, watcher);
      this.logger.debug(`Started watching file: ${filePath}`);

    } catch (error) {
      this.logger.error(`Failed to watch file ${filePath}:`, error);
      throw error;
    }
  }

  private async handleFileChange(filePath: string): Promise<void> {
    try {
      const callback = this.callbacks.get(filePath);
      if (!callback) return;

      const currentPosition = this.filePositions.get(filePath) || 0;
      const stats = await stat(filePath);

      // File was truncated
      if (stats.size < currentPosition) {
        this.filePositions.set(filePath, 0);
        return;
      }

      // No new content
      if (stats.size === currentPosition) {
        return;
      }

      // Read new content
      const buffer = Buffer.alloc(stats.size - currentPosition);
      const fileHandle = await import('fs/promises').then(fs => fs.open(filePath, 'r'));

      try {
        await fileHandle.read(buffer, 0, buffer.length, currentPosition);
        const newContent = buffer.toString('utf8');

        if (newContent.trim()) {
          callback(newContent);
        }

        this.filePositions.set(filePath, stats.size);
      } finally {
        await fileHandle.close();
      }

    } catch (error) {
      this.logger.error(`Error handling file change for ${filePath}:`, error);
    }
  }

  stopWatching(filePath: string): void {
    const watcher = this.watchers.get(filePath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(filePath);
      this.filePositions.delete(filePath);
      this.callbacks.delete(filePath);
      this.logger.debug(`Stopped watching file: ${filePath}`);
    }
  }

  stopAll(): void {
    for (const filePath of this.watchers.keys()) {
      this.stopWatching(filePath);
    }
  }

  getWatchedFiles(): string[] {
    return Array.from(this.watchers.keys());
  }
}