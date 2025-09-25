/**
 * Process Monitor - Port and process management utilities
 */

import type { ProcessInfo, PortInfo } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { CommandEscaper } from '../utils/command-escaper.js';

export class ProcessMonitor {
  private commandEscaper: CommandEscaper;

  constructor(private logger: Logger) {
    this.commandEscaper = new CommandEscaper(logger, {
      allowDangerous: false,
      logCommands: false, // Reduce noise for monitoring commands
      defaultTimeout: 10000,
    });
  }

  async listPorts(): Promise<PortInfo[]> {
    try {
      // Use lsof to get port information (works on macOS and Linux)
      const result = await this.commandEscaper.executeCommand('sh', ['-c', 'lsof -i -P -n | grep LISTEN']);
      const ports: PortInfo[] = [];

      const lines = result.stdout.trim().split('\n').filter(line => line);

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
          const pid = parseInt(parts[1]);
          const address = parts[8];

          // Parse address (format: *:port or host:port)
          const portMatch = address.match(/:(\d+)$/);
          if (portMatch) {
            const port = parseInt(portMatch[1]);
            const protocol = line.includes('TCP') ? 'tcp' : 'udp';

            ports.push({
              port,
              protocol: protocol as 'tcp' | 'udp',
              state: 'listening',
              pid,
            });
          }
        }
      }

      // Remove duplicates
      const uniquePorts = ports.filter((port, index, self) =>
        index === self.findIndex(p => p.port === port.port && p.protocol === port.protocol)
      );

      this.logger.debug(`Found ${uniquePorts.length} listening ports`);
      return uniquePorts;

    } catch (error) {
      // Fallback to netstat if lsof fails
      try {
        return await this.listPortsWithNetstat();
      } catch (fallbackError) {
        this.logger.error('Failed to list ports with both lsof and netstat:', error);
        return [];
      }
    }
  }

  private async listPortsWithNetstat(): Promise<PortInfo[]> {
    try {
      // Use netstat as fallback
      const { stdout } = await this.commandEscaper.executeCommand('netstat -tulpn 2>/dev/null | grep LISTEN || netstat -an | grep LISTEN');
      const ports: PortInfo[] = [];

      const lines = stdout.trim().split('\n').filter(line => line);

      for (const line of lines) {
        const parts = line.split(/\s+/);

        // Try to extract port from different netstat formats
        let port: number | null = null;
        let protocol: 'tcp' | 'udp' = 'tcp';
        let pid = 0;

        if (line.includes('tcp')) {
          protocol = 'tcp';
          // Look for port in address field
          const addressField = parts.find(part => part.includes(':'));
          if (addressField) {
            const portMatch = addressField.match(/:(\d+)$/);
            if (portMatch) {
              port = parseInt(portMatch[1]);
            }
          }
        }

        if (port && port > 0) {
          ports.push({
            port,
            protocol,
            state: 'listening',
            pid,
          });
        }
      }

      return ports;
    } catch (error) {
      this.logger.warn('Netstat fallback also failed:', error);
      return [];
    }
  }

  async listProcesses(pattern?: string): Promise<ProcessInfo[]> {
    try {
      let command = 'ps aux';
      if (pattern) {
        command += ` | grep "${pattern}"`;
      }

      const { stdout } = await this.commandEscaper.executeCommand(command);
      const processes: ProcessInfo[] = [];

      const lines = stdout.trim().split('\n').filter(line => line && !line.includes('grep'));

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 11) {
          const pid = parseInt(parts[1]);
          const cpu = parseFloat(parts[2]);
          const memory = parseFloat(parts[3]);
          const status = parts[7];
          const command = parts.slice(10).join(' ');
          const name = parts[10].split('/').pop() || parts[10];

          // Get ports for this process
          const ports = await this.getProcessPorts(pid);

          processes.push({
            pid,
            name,
            command,
            ports,
            cpu,
            memory,
            status: this.mapProcessStatus(status),
          });
        }
      }

      this.logger.debug(`Found ${processes.length} processes`);
      return processes;

    } catch (error) {
      this.logger.error('Failed to list processes:', error);
      return [];
    }
  }

  private async getProcessPorts(pid: number): Promise<PortInfo[]> {
    try {
      const { stdout } = await this.commandEscaper.executeCommand(`lsof -i -P -n -p ${pid} 2>/dev/null || echo ""`);
      const ports: PortInfo[] = [];

      const lines = stdout.trim().split('\n').filter(line => line);

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
          const address = parts[8];
          const portMatch = address.match(/:(\d+)$/);

          if (portMatch) {
            const port = parseInt(portMatch[1]);
            const protocol = line.includes('TCP') ? 'tcp' : 'udp';

            let state: 'listening' | 'established' | 'closed' = 'closed';
            if (line.includes('LISTEN')) state = 'listening';
            if (line.includes('ESTABLISHED')) state = 'established';

            ports.push({
              port,
              protocol: protocol as 'tcp' | 'udp',
              state,
              pid,
            });
          }
        }
      }

      return ports;
    } catch (error) {
      return [];
    }
  }

  private mapProcessStatus(status: string): 'running' | 'sleeping' | 'stopped' {
    const firstChar = status.charAt(0).toLowerCase();
    switch (firstChar) {
      case 'r': return 'running';
      case 's': case 'i': return 'sleeping';
      case 't': case 'z': return 'stopped';
      default: return 'running';
    }
  }

  async killProcesses(pattern: string): Promise<{ killed: number; failed: number; pids: number[] }> {
    try {
      this.logger.info(`Killing processes matching pattern: ${pattern}`);

      // Find processes matching pattern
      const processes = await this.listProcesses(pattern);
      const pids = processes.map(p => p.pid);

      if (pids.length === 0) {
        this.logger.info('No processes found matching pattern');
        return { killed: 0, failed: 0, pids: [] };
      }

      let killed = 0;
      let failed = 0;

      for (const pid of pids) {
        try {
          await this.commandEscaper.executeCommand('kill', [pid.toString()]);
          killed++;
          this.logger.debug(`Killed process ${pid}`);
        } catch (error) {
          try {
            // Try force kill
            await this.commandEscaper.executeCommand('kill', ['-9', pid.toString()]);
            killed++;
            this.logger.debug(`Force killed process ${pid}`);
          } catch (forceError) {
            failed++;
            this.logger.warn(`Failed to kill process ${pid}:`, forceError);
          }
        }
      }

      this.logger.info(`Process kill summary: ${killed} killed, ${failed} failed`);
      return { killed, failed, pids };

    } catch (error) {
      this.logger.error('Failed to kill processes:', error);
      throw error;
    }
  }

  async getProcessHealth(pid: number): Promise<ProcessInfo | null> {
    try {
      const processes = await this.listProcesses();
      return processes.find(p => p.pid === pid) || null;
    } catch (error) {
      this.logger.error(`Failed to get health for process ${pid}:`, error);
      return null;
    }
  }

  async restartProcess(pattern: string, command: string): Promise<{ success: boolean; newPid?: number }> {
    try {
      this.logger.info(`Restarting process matching: ${pattern}`);

      // Kill existing processes
      const killResult = await this.killProcesses(pattern);

      // Wait a moment for processes to die
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Start new process
      const { stdout } = await this.commandEscaper.executeCommand(command);

      // Try to find the new process
      const newProcesses = await this.listProcesses(pattern);
      const newPid = newProcesses.length > 0 ? newProcesses[0].pid : undefined;

      this.logger.info(`Process restart completed. New PID: ${newPid}`);

      return {
        success: true,
        newPid,
      };

    } catch (error) {
      this.logger.error('Failed to restart process:', error);
      return { success: false };
    }
  }

  async monitorPort(port: number, intervalMs: number = 5000): Promise<() => void> {
    this.logger.info(`Starting port monitoring for port ${port}`);

    const checkPort = async () => {
      try {
        const ports = await this.listPorts();
        const portInfo = ports.find(p => p.port === port);

        if (portInfo) {
          this.logger.debug(`Port ${port} is active (PID: ${portInfo.pid})`);
        } else {
          this.logger.warn(`Port ${port} is not listening`);
        }
      } catch (error) {
        this.logger.error(`Port monitoring error for ${port}:`, error);
      }
    };

    // Initial check
    await checkPort();

    // Set up interval monitoring
    const interval = setInterval(checkPort, intervalMs);

    // Return cleanup function (in real implementation, you'd want to manage this)
    return () => clearInterval(interval);
  }

  async getSystemLoad(): Promise<{ loadAverage: number[]; uptime: number }> {
    try {
      const { stdout: uptimeOut } = await this.commandEscaper.executeCommand('uptime');

      // Parse uptime output for load average
      const loadMatch = uptimeOut.match(/load average[s]?:\s*([0-9.]+),?\s*([0-9.]+),?\s*([0-9.]+)/i);
      const loadAverage = loadMatch ? [
        parseFloat(loadMatch[1]),
        parseFloat(loadMatch[2]),
        parseFloat(loadMatch[3])
      ] : [0, 0, 0];

      // Get uptime in seconds
      const { stdout: uptimeSeconds } = await this.commandEscaper.executeCommand("awk '{print $1}' /proc/uptime 2>/dev/null || echo '0'");
      const uptime = parseFloat(uptimeSeconds.trim()) || 0;

      return { loadAverage, uptime };

    } catch (error) {
      this.logger.error('Failed to get system load:', error);
      return { loadAverage: [0, 0, 0], uptime: 0 };
    }
  }
}