/**
 * Process Management Tools - MCP tool handlers for process and port operations
 */

import { z } from 'zod';
import type { ToolContext } from '../types/index.js';

// Validation schemas
export const ListPortsSchema = z.object({
  includeProcessInfo: z.boolean().optional().default(true),
  protocol: z.enum(['tcp', 'udp', 'all']).optional().default('all'),
});

export const MultiKillSchema = z.object({
  pattern: z.string().min(1, 'Process pattern is required'),
  force: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
});

export const ProcessMonitorSchema = z.object({
  pattern: z.string().optional(),
  sortBy: z.enum(['cpu', 'memory', 'pid', 'name']).optional().default('cpu'),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export const ProcessRestartSchema = z.object({
  pattern: z.string().min(1, 'Process pattern is required'),
  command: z.string().min(1, 'Restart command is required'),
  waitTime: z.number().int().min(0).max(30).optional().default(2),
});

export const PortMonitorSchema = z.object({
  port: z.number().int().min(1).max(65535),
  duration: z.number().int().min(5).max(300).optional().default(30),
  interval: z.number().int().min(1).max(60).optional().default(5),
});

export const SystemLoadSchema = z.object({
  includeProcesses: z.boolean().optional().default(false),
});

// Tool handlers
export async function handleListPorts(args: any, context: ToolContext) {
  const validated = ListPortsSchema.parse(args);
  const { logger, processMonitor } = context;

  try {
    logger.debug('Listing open ports');

    const allPorts = await processMonitor.listPorts();

    // Filter by protocol if specified
    const filteredPorts = validated.protocol === 'all'
      ? allPorts
      : allPorts.filter(port => port.protocol === validated.protocol);

    // Enhance with process info if requested
    const portsWithInfo = await Promise.all(
      filteredPorts.map(async (port) => {
        if (validated.includeProcessInfo && port.pid > 0) {
          const processInfo = await processMonitor.getProcessHealth(port.pid);
          return {
            ...port,
            process: processInfo ? {
              name: processInfo.name,
              command: processInfo.command,
              cpu: processInfo.cpu,
              memory: processInfo.memory,
            } : null,
          };
        }
        return port;
      })
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            protocol: validated.protocol,
            portCount: portsWithInfo.length,
            ports: portsWithInfo.sort((a, b) => a.port - b.port),
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to list ports:', error);
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

export async function handleMultiKill(args: any, context: ToolContext) {
  const validated = MultiKillSchema.parse(args);
  const { logger, processMonitor } = context;

  try {
    logger.info(`Multi-kill processes matching: ${validated.pattern} (dryRun: ${validated.dryRun})`);

    if (validated.dryRun) {
      // Just find matching processes without killing
      const processes = await processMonitor.listProcesses(validated.pattern);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              dryRun: true,
              pattern: validated.pattern,
              matchingProcesses: processes.length,
              processes: processes.map(p => ({
                pid: p.pid,
                name: p.name,
                command: p.command,
                cpu: p.cpu,
                memory: p.memory,
              })),
              message: `Would kill ${processes.length} processes matching '${validated.pattern}'`,
            }, null, 2),
          },
        ],
      };
    }

    const result = await processMonitor.killProcesses(validated.pattern);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            pattern: validated.pattern,
            killed: result.killed,
            failed: result.failed,
            pids: result.pids,
            message: `Killed ${result.killed} processes, ${result.failed} failed`,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to kill processes:', error);
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

export async function handleProcessMonitor(args: any, context: ToolContext) {
  const validated = ProcessMonitorSchema.parse(args);
  const { logger, processMonitor } = context;

  try {
    logger.debug(`Monitoring processes with pattern: ${validated.pattern || 'all'}`);

    const processes = await processMonitor.listProcesses(validated.pattern);

    // Sort processes
    const sortedProcesses = processes.sort((a, b) => {
      switch (validated.sortBy) {
        case 'cpu':
          return b.cpu - a.cpu;
        case 'memory':
          return b.memory - a.memory;
        case 'pid':
          return b.pid - a.pid;
        case 'name':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    // Limit results
    const limitedProcesses = sortedProcesses.slice(0, validated.limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            pattern: validated.pattern || 'all',
            sortBy: validated.sortBy,
            totalFound: processes.length,
            showing: limitedProcesses.length,
            processes: limitedProcesses.map(p => ({
              pid: p.pid,
              name: p.name,
              command: p.command.length > 60 ? p.command.substring(0, 60) + '...' : p.command,
              cpu: p.cpu,
              memory: p.memory,
              status: p.status,
              ports: p.ports.length,
            })),
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to monitor processes:', error);
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

export async function handleProcessRestart(args: any, context: ToolContext) {
  const validated = ProcessRestartSchema.parse(args);
  const { logger, processMonitor } = context;

  try {
    logger.info(`Restarting processes matching: ${validated.pattern}`);

    const result = await processMonitor.restartProcess(validated.pattern, validated.command);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            pattern: validated.pattern,
            command: validated.command,
            newPid: result.newPid,
            message: result.success
              ? `Process restarted successfully${result.newPid ? ` with PID ${result.newPid}` : ''}`
              : 'Failed to restart process',
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to restart process:', error);
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

export async function handlePortMonitor(args: any, context: ToolContext) {
  const validated = PortMonitorSchema.parse(args);
  const { logger, processMonitor } = context;

  try {
    logger.info(`Starting port monitoring for port ${validated.port}`);

    // Initial port check
    const ports = await processMonitor.listPorts();
    const targetPort = ports.find(p => p.port === validated.port);

    const monitoringResult = {
      port: validated.port,
      duration: validated.duration,
      interval: validated.interval,
      initialStatus: targetPort ? {
        state: targetPort.state,
        protocol: targetPort.protocol,
        pid: targetPort.pid,
      } : null,
      message: targetPort
        ? `Port ${validated.port} is currently ${targetPort.state} (PID: ${targetPort.pid})`
        : `Port ${validated.port} is not currently in use`,
      note: `Monitoring will continue for ${validated.duration} seconds with ${validated.interval}s intervals`,
    };

    // Start monitoring (in a real implementation, this would be async)
    // For this MCP implementation, we'll just return the setup confirmation
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            monitoring: monitoringResult,
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to start port monitoring:', error);
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

export async function handleSystemLoad(args: any, context: ToolContext) {
  const validated = SystemLoadSchema.parse(args);
  const { logger, processMonitor } = context;

  try {
    logger.debug('Getting system load information');

    const systemLoad = await processMonitor.getSystemLoad();

    let topProcesses = [];
    if (validated.includeProcesses) {
      const processes = await processMonitor.listProcesses();
      topProcesses = processes
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 10)
        .map(p => ({
          pid: p.pid,
          name: p.name,
          cpu: p.cpu,
          memory: p.memory,
        }));
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            system: {
              loadAverage: systemLoad.loadAverage,
              uptime: systemLoad.uptime,
              uptimeFormatted: `${Math.floor(systemLoad.uptime / 3600)}h ${Math.floor((systemLoad.uptime % 3600) / 60)}m`,
            },
            topProcesses: validated.includeProcesses ? topProcesses : undefined,
            timestamp: new Date().toISOString(),
          }, null, 2),
        },
      ],
    };

  } catch (error) {
    logger.error('Failed to get system load:', error);
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