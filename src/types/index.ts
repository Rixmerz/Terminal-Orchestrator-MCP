/**
 * TypeScript definitions for terminal-orchestrator-mcp
 */

export interface TmuxSession {
  name: string;
  id: string;
  windows: TmuxWindow[];
  created: Date;
  attached: boolean;
}

export interface TmuxWindow {
  id: string;
  name: string;
  panes: TmuxPane[];
  active: boolean;
}

export interface TmuxPane {
  id: string; // Structured ID (e.g., "session:0.0")
  nativeId?: string; // Tmux native ID (e.g., "%3")
  windowId: string;
  sessionName: string;
  index: number;
  title: string;
  command: string;
  pid: number;
  logFile?: string;
  active: boolean;
}

export interface LogEntry {
  timestamp: Date;
  paneId: string;
  content: string;
  type: 'stdout' | 'stderr';
}

export interface ErrorEntry {
  id: string;
  paneId: string;
  file?: string;
  line?: number;
  column?: number;
  message: string;
  type: 'error' | 'warning' | 'info';
  language?: string;
  timestamp: Date;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  command: string;
  ports: PortInfo[];
  cpu: number;
  memory: number;
  status: 'running' | 'sleeping' | 'stopped';
}

export interface PortInfo {
  port: number;
  protocol: 'tcp' | 'udp';
  state: 'listening' | 'established' | 'closed';
  pid: number;
}

export interface LogSummary {
  paneId: string;
  totalLines: number;
  errors: number;
  warnings: number;
  timeRange: {
    start: Date;
    end: Date;
  };
  errorSamples: ErrorEntry[];
  patterns: {
    [pattern: string]: number;
  };
}

export interface SessionConfig {
  name: string;
  windows: WindowConfig[];
  environment?: Record<string, string>;
  workingDirectory?: string;
}

export interface WindowConfig {
  name: string;
  panes: PaneConfig[];
}

export interface PaneConfig {
  command?: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
}

export interface TmuxManagerOptions {
  logDirectory: string;
  maxLogSize: number;
  enableLogging: boolean;
  sessionTimeout: number;
}

export interface WatcherOptions {
  debounceMs: number;
  maxFileSize: number;
  excludePatterns: string[];
}

export interface ErrorPattern {
  name: string;
  regex: RegExp;
  type: 'error' | 'warning' | 'info';
  language?: string;
  captureGroups: {
    file?: number;
    line?: number;
    column?: number;
    message: number;
  };
}

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

export interface ToolContext {
  logger: any;
  errorHandler: any;
  tmuxManager: any;
  logAnalyzer: any;
  processMonitor: any;
  errorWatcher: any;
  sessionSerializer?: any;
  mcpIntegrator?: any;
  frameworkDetector?: any;
}