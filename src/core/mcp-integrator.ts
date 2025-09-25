/**
 * MCP Integrator - Cross-tool orchestration and event-driven MCP communication
 *
 * Provides intelligent triggers for other MCP servers based on tmux events
 */

import { EventEmitter } from 'events';
import type { Logger } from '../utils/logger.js';
import type { ErrorEntry, ProcessHealth, TmuxPane } from '../types/index.js';

export interface McpTrigger {
  /** Event that triggers the MCP call */
  event: string;
  /** MCP server/tool to trigger */
  target: string;
  /** Condition for triggering (optional) */
  condition?: (data: any) => boolean;
  /** Parameters to pass to the MCP call */
  parameters?: Record<string, any>;
  /** Debounce time in ms to prevent spam */
  debounceMs?: number;
  /** Whether to run in background */
  background?: boolean;
}

export interface McpIntegrationConfig {
  /** Sequential thinking triggers */
  sequentialThinking: {
    enabled: boolean;
    triggers: {
      onError: boolean;
      onMultipleErrors: number; // Trigger after N errors
      onProcessCrash: boolean;
      onDependencyFailure: boolean;
    };
  };

  /** RIKA UI testing triggers */
  rikaTesting: {
    enabled: boolean;
    triggers: {
      onUIChange: boolean;
      onPortChange: boolean;
      onBuildComplete: boolean;
    };
  };

  /** Context7 documentation triggers */
  context7Docs: {
    enabled: boolean;
    triggers: {
      onFrameworkDetection: boolean;
      onErrorPattern: boolean;
      onNewDependency: boolean;
    };
  };

  /** Magic UI component triggers */
  magicUI: {
    enabled: boolean;
    triggers: {
      onReactError: boolean;
      onComponentRequest: boolean;
    };
  };
}

export interface McpEvent {
  type: string;
  paneId?: string;
  data: any;
  timestamp: Date;
  source: 'tmux' | 'error-watcher' | 'process-monitor' | 'framework-detector';
}

export class McpIntegrator extends EventEmitter {
  private lastTriggers = new Map<string, Date>();
  private activeAnalyses = new Set<string>();

  constructor(
    private logger: Logger,
    private config: McpIntegrationConfig = {
      sequentialThinking: {
        enabled: true,
        triggers: {
          onError: true,
          onMultipleErrors: 3,
          onProcessCrash: true,
          onDependencyFailure: true,
        },
      },
      rikaTesting: {
        enabled: false, // Disabled by default
        triggers: {
          onUIChange: false,
          onPortChange: false,
          onBuildComplete: false,
        },
      },
      context7Docs: {
        enabled: true,
        triggers: {
          onFrameworkDetection: true,
          onErrorPattern: true,
          onNewDependency: false,
        },
      },
      magicUI: {
        enabled: false, // Disabled by default
        triggers: {
          onReactError: false,
          onComponentRequest: false,
        },
      },
    }
  ) {
    super();
    this.setupEventHandlers();
  }

  /**
   * Process an error event and trigger appropriate MCP actions
   */
  async handleError(error: ErrorEntry): Promise<void> {
    this.logger.debug(`Processing error event for pane ${error.paneId}: ${error.message}`);

    const event: McpEvent = {
      type: 'error_detected',
      paneId: error.paneId,
      data: error,
      timestamp: new Date(),
      source: 'error-watcher',
    };

    this.emit('mcp_event', event);

    // Sequential thinking trigger for errors
    if (this.config.sequentialThinking.enabled && this.config.sequentialThinking.triggers.onError) {
      await this.triggerSequentialAnalysis(error.paneId, {
        type: 'error_analysis',
        error: {
          message: error.message,
          type: error.type,
          file: error.file,
          line: error.line,
          language: error.language,
        },
        context: 'Single error detected in development environment',
      });
    }

    // Context7 documentation lookup for unknown error patterns
    if (this.config.context7Docs.enabled && this.config.context7Docs.triggers.onErrorPattern) {
      if (error.language && this.isNewErrorPattern(error)) {
        await this.triggerDocumentationLookup(error.language, error.message, 'error');
      }
    }
  }

  /**
   * Handle multiple errors (batch processing)
   */
  async handleMultipleErrors(paneId: string, errors: ErrorEntry[]): Promise<void> {
    const errorCount = errors.length;
    this.logger.info(`Processing ${errorCount} errors for pane ${paneId}`);

    // Trigger sequential thinking for systematic analysis
    if (
      this.config.sequentialThinking.enabled &&
      errorCount >= this.config.sequentialThinking.triggers.onMultipleErrors
    ) {
      await this.triggerSequentialAnalysis(paneId, {
        type: 'multiple_errors_analysis',
        errorCount,
        errors: errors.map(e => ({
          message: e.message,
          type: e.type,
          file: e.file,
          line: e.line,
          language: e.language,
        })),
        context: `Multiple errors (${errorCount}) detected, requiring systematic analysis`,
        urgency: 'high',
      });
    }
  }

  /**
   * Handle process crash events
   */
  async handleProcessCrash(health: ProcessHealth): Promise<void> {
    this.logger.warn(`Processing process crash for pane ${health.paneId}: ${health.processName}`);

    const event: McpEvent = {
      type: 'process_crashed',
      paneId: health.paneId,
      data: health,
      timestamp: new Date(),
      source: 'process-monitor',
    };

    this.emit('mcp_event', event);

    // Sequential thinking for crash analysis
    if (this.config.sequentialThinking.enabled && this.config.sequentialThinking.triggers.onProcessCrash) {
      await this.triggerSequentialAnalysis(health.paneId, {
        type: 'crash_analysis',
        process: {
          name: health.processName,
          pid: health.pid,
          restartCount: health.restartCount,
          lastHealthCheck: health.lastHealthCheck,
          memoryUsage: health.memoryUsage,
          cpuUsage: health.cpuUsage,
        },
        context: 'Process crashed, analyzing potential causes and recovery options',
        urgency: 'critical',
      });
    }
  }

  /**
   * Handle framework detection events
   */
  async handleFrameworkDetection(frameworks: Array<{ name: string; confidence: number; indicators: string[] }>): Promise<void> {
    this.logger.info(`Framework detection completed: ${frameworks.map(f => f.name).join(', ')}`);

    // Context7 lookup for framework-specific documentation
    if (this.config.context7Docs.enabled && this.config.context7Docs.triggers.onFrameworkDetection) {
      for (const framework of frameworks) {
        if (framework.confidence > 0.8) { // High confidence frameworks
          await this.triggerDocumentationLookup(
            framework.name,
            `${framework.name} best practices and common patterns`,
            'framework_setup'
          );
        }
      }
    }
  }

  /**
   * Handle UI/port changes (for RIKA integration)
   */
  async handlePortChange(port: number, status: 'opened' | 'closed', paneId?: string): Promise<void> {
    if (!this.config.rikaTesting.enabled || !this.config.rikaTesting.triggers.onPortChange) {
      return;
    }

    this.logger.debug(`Port ${port} ${status}${paneId ? ` in pane ${paneId}` : ''}`);

    // Trigger RIKA testing for UI port changes (typically 3000, 8080, etc.)
    if (this.isUIPort(port) && status === 'opened') {
      await this.triggerRikaTest(port, paneId);
    }
  }

  /**
   * Trigger sequential thinking MCP analysis
   */
  private async triggerSequentialAnalysis(paneId: string, params: any): Promise<void> {
    const key = `sequential_${paneId}`;

    // Prevent duplicate analyses
    if (this.activeAnalyses.has(key)) {
      this.logger.debug(`Sequential analysis already active for pane ${paneId}`);
      return;
    }

    // Check debounce (5 minute cooldown for analyses)
    const lastTrigger = this.lastTriggers.get(key);
    const debounceMs = 5 * 60 * 1000; // 5 minutes
    if (lastTrigger && Date.now() - lastTrigger.getTime() < debounceMs) {
      this.logger.debug(`Sequential analysis debounced for pane ${paneId}`);
      return;
    }

    try {
      this.activeAnalyses.add(key);
      this.lastTriggers.set(key, new Date());

      this.logger.info(`Triggering sequential thinking analysis for pane ${paneId}`);

      // Emit event for external handling (actual MCP call would be handled by the server)
      this.emit('trigger_sequential', {
        paneId,
        analysis: params,
        timestamp: new Date(),
      });

      // In a real implementation, this would make an actual MCP call to sequential-thinking
      // For now, we log the intention
      this.logger.debug('Sequential thinking trigger parameters:', JSON.stringify(params, null, 2));

    } catch (error) {
      this.logger.error(`Failed to trigger sequential analysis for pane ${paneId}:`, error);
    } finally {
      this.activeAnalyses.delete(key);
    }
  }

  /**
   * Trigger Context7 documentation lookup
   */
  private async triggerDocumentationLookup(
    library: string,
    query: string,
    type: 'error' | 'framework_setup' | 'best_practices'
  ): Promise<void> {
    const key = `context7_${library}_${type}`;

    // Check debounce (10 minute cooldown for doc lookups)
    const lastTrigger = this.lastTriggers.get(key);
    const debounceMs = 10 * 60 * 1000; // 10 minutes
    if (lastTrigger && Date.now() - lastTrigger.getTime() < debounceMs) {
      return;
    }

    try {
      this.lastTriggers.set(key, new Date());

      this.logger.info(`Triggering Context7 documentation lookup: ${library} - ${query}`);

      // Emit event for external handling
      this.emit('trigger_context7', {
        library,
        query,
        type,
        timestamp: new Date(),
      });

    } catch (error) {
      this.logger.error(`Failed to trigger documentation lookup for ${library}:`, error);
    }
  }

  /**
   * Trigger RIKA UI testing
   */
  private async triggerRikaTest(port: number, paneId?: string): Promise<void> {
    const key = `rika_${port}`;

    // Check debounce (2 minute cooldown for UI tests)
    const lastTrigger = this.lastTriggers.get(key);
    const debounceMs = 2 * 60 * 1000; // 2 minutes
    if (lastTrigger && Date.now() - lastTrigger.getTime() < debounceMs) {
      return;
    }

    try {
      this.lastTriggers.set(key, new Date());

      this.logger.info(`Triggering RIKA UI test for port ${port}`);

      // Emit event for external handling
      this.emit('trigger_rika', {
        port,
        paneId,
        url: `http://localhost:${port}`,
        testType: 'accessibility_audit',
        timestamp: new Date(),
      });

    } catch (error) {
      this.logger.error(`Failed to trigger RIKA test for port ${port}:`, error);
    }
  }

  /**
   * Check if this is a new error pattern worth looking up
   */
  private isNewErrorPattern(error: ErrorEntry): boolean {
    // Simple heuristic - check if we've seen this error type recently
    const key = `error_${error.type}_${error.message.slice(0, 50)}`;
    const lastSeen = this.lastTriggers.get(key);
    const debounceMs = 30 * 60 * 1000; // 30 minutes

    if (!lastSeen || Date.now() - lastSeen.getTime() > debounceMs) {
      this.lastTriggers.set(key, new Date());
      return true;
    }

    return false;
  }

  /**
   * Check if port is typically used for UI development
   */
  private isUIPort(port: number): boolean {
    const commonUIPorts = [3000, 3001, 4000, 4200, 5000, 8000, 8080, 8100, 9000, 9090];
    return commonUIPorts.includes(port);
  }

  /**
   * Setup internal event handlers
   */
  private setupEventHandlers(): void {
    // Example: Listen for our own events to provide feedback
    this.on('trigger_sequential', (data) => {
      this.logger.debug(`Sequential thinking triggered for analysis: ${data.analysis.type}`);
    });

    this.on('trigger_context7', (data) => {
      this.logger.debug(`Context7 lookup triggered: ${data.library} - ${data.type}`);
    });

    this.on('trigger_rika', (data) => {
      this.logger.debug(`RIKA testing triggered for: ${data.url}`);
    });
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<McpIntegrationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('MCP integration configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): McpIntegrationConfig {
    return { ...this.config };
  }

  /**
   * Get integration statistics
   */
  getStats(): {
    totalTriggers: number;
    activeTriggers: number;
    recentTriggers: Array<{ key: string; timestamp: Date }>;
  } {
    const recentCutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

    const recentTriggers = Array.from(this.lastTriggers.entries())
      .filter(([key, timestamp]) => timestamp > recentCutoff)
      .map(([key, timestamp]) => ({ key, timestamp }))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return {
      totalTriggers: this.lastTriggers.size,
      activeTriggers: this.activeAnalyses.size,
      recentTriggers: recentTriggers.slice(0, 20), // Last 20 triggers
    };
  }

  /**
   * Clear trigger history (for testing or reset)
   */
  clearHistory(): void {
    this.lastTriggers.clear();
    this.activeAnalyses.clear();
    this.logger.info('MCP integration trigger history cleared');
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.removeAllListeners();
    this.lastTriggers.clear();
    this.activeAnalyses.clear();
  }
}