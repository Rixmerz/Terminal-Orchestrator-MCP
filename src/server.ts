/**
 * TmuxMCPServer - Main server class for the intelligent terminal orchestrator
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Logger, LogLevel } from './utils/logger.js';
import { ErrorHandler } from './utils/errors.js';
import { TmuxManager } from './core/tmux-manager.js';
import { LogAnalyzer } from './core/log-analyzer.js';
import { ProcessMonitor } from './core/process-monitor.js';
import { ErrorWatcher } from './core/error-watcher.js';
import { SessionStore } from './storage/session-store.js';
import { SessionSerializer } from './core/session-serializer.js';
import { McpIntegrator } from './core/mcp-integrator.js';
import { FrameworkDetector } from './utils/framework-detector.js';
import { registerTools } from './tools/index.js';
import type { ToolContext } from './types/index.js';

export interface ServerConfig {
  logLevel: LogLevel;
  logDirectory: string;
  maxLogSize: number;
  sessionTimeout: number;
  enableLogging: boolean;
  storageDirectory: string;
}

export class TmuxMCPServer {
  private server: Server;
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private tmuxManager!: TmuxManager;
  private logAnalyzer!: LogAnalyzer;
  private processMonitor!: ProcessMonitor;
  private errorWatcher!: ErrorWatcher;
  private sessionStore!: SessionStore;
  private sessionSerializer!: SessionSerializer;
  private mcpIntegrator!: McpIntegrator;
  private frameworkDetector!: FrameworkDetector;
  private config: ServerConfig;

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = {
      logLevel: LogLevel.INFO,
      logDirectory: './logs',
      maxLogSize: 100 * 1024 * 1024, // 100MB
      sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
      enableLogging: true,
      storageDirectory: './storage',
      ...config,
    };

    // Override with environment variables
    if (process.env.LOG_LEVEL) {
      this.config.logLevel = process.env.LOG_LEVEL as LogLevel;
    }
    if (process.env.LOG_DIRECTORY) {
      this.config.logDirectory = process.env.LOG_DIRECTORY;
    }
    if (process.env.MAX_LOG_SIZE) {
      this.config.maxLogSize = parseInt(process.env.MAX_LOG_SIZE, 10);
    }
    if (process.env.SESSION_TIMEOUT) {
      this.config.sessionTimeout = parseInt(process.env.SESSION_TIMEOUT, 10);
    }

    this.server = new Server(
      {
        name: 'terminal-orchestrator-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.logger = new Logger(this.config.logLevel);
    this.errorHandler = new ErrorHandler(this.logger);
    this.setupErrorHandling();
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info('Starting Tmux MCP Server initialization...');

      // Initialize core components
      this.logger.info('Initializing core components...');

      this.tmuxManager = new TmuxManager(this.logger, {
        logDirectory: this.config.logDirectory,
        maxLogSize: this.config.maxLogSize,
        enableLogging: this.config.enableLogging,
        sessionTimeout: this.config.sessionTimeout,
      });

      this.logAnalyzer = new LogAnalyzer(this.logger);

      this.processMonitor = new ProcessMonitor(this.logger);

      this.errorWatcher = new ErrorWatcher(this.logger, {
        debounceMs: 500,
        maxFileSize: this.config.maxLogSize,
        excludePatterns: ['node_modules/**', '.git/**', 'dist/**'],
      });

      this.sessionStore = new SessionStore(this.logger, {
        storageDirectory: this.config.storageDirectory,
        maxSessions: 50,
        cleanupInterval: 30 * 60 * 1000,
        sessionTimeout: this.config.sessionTimeout,
      });

      // Initialize new enhanced components
      this.sessionSerializer = new SessionSerializer(this.logger, this.config.storageDirectory);
      this.frameworkDetector = new FrameworkDetector(this.logger);
      this.mcpIntegrator = new McpIntegrator(this.logger);

      // Initialize all components
      await this.tmuxManager.initialize();
      await this.sessionStore.initialize();
      await this.sessionSerializer.initialize();

      // Setup error watcher event handlers with MCP integration
      this.errorWatcher.on('error', async (error) => {
        this.logger.warn(`Error detected in pane ${error.paneId}: ${error.message}`);
        await this.mcpIntegrator.handleError(error);
      });

      this.errorWatcher.on('warning', (warning) => {
        this.logger.debug(`Warning detected in pane ${warning.paneId}: ${warning.message}`);
      });

      // Setup MCP integration event handlers
      this.mcpIntegrator.on('trigger_sequential', (data) => {
        this.logger.info(`Sequential thinking triggered: ${data.analysis.type} for pane ${data.paneId}`);
        // In a real implementation, this would call the sequential-thinking MCP
      });

      this.mcpIntegrator.on('trigger_context7', (data) => {
        this.logger.info(`Context7 documentation lookup triggered: ${data.library}`);
        // In a real implementation, this would call the Context7 MCP
      });

      this.mcpIntegrator.on('trigger_rika', (data) => {
        this.logger.info(`RIKA testing triggered for port ${data.port}`);
        // In a real implementation, this would call the RIKA MCP
      });

      // Register all tools
      this.logger.info('Registering MCP tools...');
      const toolContext: ToolContext = {
        logger: this.logger,
        errorHandler: this.errorHandler,
        tmuxManager: this.tmuxManager,
        logAnalyzer: this.logAnalyzer,
        processMonitor: this.processMonitor,
        errorWatcher: this.errorWatcher,
        sessionSerializer: this.sessionSerializer,
        mcpIntegrator: this.mcpIntegrator,
        frameworkDetector: this.frameworkDetector,
      };

      await registerTools(this.server, toolContext);

      // Restore any persisted sessions on startup
      await this.restorePersistedSessions();

      this.logger.info('Tmux MCP Server initialized successfully');
      this.logServerInfo();

    } catch (error) {
      this.logger.error('Failed to initialize server:', error);
      throw error;
    }
  }

  private async restorePersistedSessions(): Promise<void> {
    try {
      const sessions = await this.sessionStore.getAllSessions();
      this.logger.info(`Found ${sessions.length} persisted sessions`);

      // Note: We don't automatically recreate tmux sessions on startup
      // They should be recreated on-demand or manually by the user
      // This just logs what sessions we have stored

      for (const session of sessions) {
        this.logger.debug(`Persisted session: ${session.sessionName} (last accessed: ${session.lastAccessed})`);
      }

    } catch (error) {
      this.logger.error('Failed to restore persisted sessions:', error);
    }
  }

  private logServerInfo(): void {
    const stats = {
      logDirectory: this.config.logDirectory,
      storageDirectory: this.config.storageDirectory,
      maxLogSize: `${(this.config.maxLogSize / 1024 / 1024).toFixed(1)}MB`,
      sessionTimeout: `${(this.config.sessionTimeout / 1000 / 60 / 60).toFixed(1)}h`,
      enableLogging: this.config.enableLogging,
    };

    this.logger.info('Server configuration:', stats);
  }

  private setupErrorHandling(): void {
    // Global error handlers
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception:', error);
      this.shutdown().then(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      this.shutdown().then(() => process.exit(1));
    });

    // Graceful shutdown handlers
    process.on('SIGINT', async () => {
      this.logger.info('Received SIGINT, shutting down gracefully...');
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      this.logger.info('Received SIGTERM, shutting down gracefully...');
      await this.shutdown();
      process.exit(0);
    });
  }

  async start(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      this.logger.info('Tmux MCP Server started and listening on stdio');
    } catch (error) {
      this.logger.error('Failed to start server:', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.logger.info('Shutting down Tmux MCP Server...');

      // Cleanup components
      if (this.errorWatcher) {
        this.errorWatcher.destroy();
      }

      if (this.sessionStore) {
        await this.sessionStore.destroy();
      }

      // Save any pending state
      this.logger.info('Tmux MCP Server shutdown complete');
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
    }
  }

  // Health check method
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    components: Record<string, boolean>;
    stats: any;
  }> {
    try {
      const components = {
        tmuxAvailable: false,
        loggingEnabled: this.config.enableLogging,
        storageAccessible: false,
      };

      // Check tmux availability
      try {
        await this.tmuxManager.listSessions();
        components.tmuxAvailable = true;
      } catch {
        components.tmuxAvailable = false;
      }

      // Check storage accessibility
      try {
        await this.sessionStore.getSessionStats();
        components.storageAccessible = true;
      } catch {
        components.storageAccessible = false;
      }

      const stats = await this.sessionStore.getSessionStats();

      return {
        status: components.tmuxAvailable && components.storageAccessible ? 'healthy' : 'unhealthy',
        components,
        stats,
      };

    } catch (error) {
      this.logger.error('Health check failed:', error);
      return {
        status: 'unhealthy',
        components: {},
        stats: {},
      };
    }
  }
}