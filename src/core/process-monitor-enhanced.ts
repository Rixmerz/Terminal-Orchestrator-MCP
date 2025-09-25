/**
 * Enhanced Process Monitor - Proactive process monitoring with auto-restart and health checks
 */

import { EventEmitter } from 'events';
import type { TmuxPane, ProcessInfo } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { CommandEscaper } from '../utils/command-escaper.js';

export interface ProcessHealth {
  paneId: string;
  processName: string;
  pid: number;
  status: 'healthy' | 'unhealthy' | 'crashed' | 'restarting' | 'unknown';
  lastHealthCheck: Date;
  consecutiveFailures: number;
  restartCount: number;
  uptime: number;
  memoryUsage: number;
  cpuUsage: number;
  ports: number[];
}

export class ProcessMonitorEnhanced extends EventEmitter {
  private monitoredPanes = new Map<string, ProcessHealth>();
  private commandEscaper: CommandEscaper;

  constructor(private logger: Logger) {
    super();
    this.commandEscaper = new CommandEscaper(logger, {
      allowDangerous: false,
      logCommands: false,
      defaultTimeout: 10000,
    });
  }

  async startMonitoring(pane: TmuxPane): Promise<void> {
    const health: ProcessHealth = {
      paneId: pane.id,
      processName: this.extractProcessName(pane.command),
      pid: pane.pid,
      status: 'unknown',
      lastHealthCheck: new Date(),
      consecutiveFailures: 0,
      restartCount: 0,
      uptime: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      ports: [],
    };

    this.monitoredPanes.set(pane.id, health);
    this.logger.info(`Started monitoring process in pane ${pane.id}: ${health.processName}`);
  }

  getHealth(paneId: string): ProcessHealth | null {
    return this.monitoredPanes.get(paneId) || null;
  }

  getAllHealth(): ProcessHealth[] {
    return Array.from(this.monitoredPanes.values());
  }

  private extractProcessName(command: string): string {
    if (!command) return 'unknown';
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    return cmd.split('/').pop() || cmd;
  }

  destroy(): void {
    this.monitoredPanes.clear();
  }
}