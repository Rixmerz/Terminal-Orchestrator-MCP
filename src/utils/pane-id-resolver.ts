/**
 * PaneIdResolver - Manages consistent pane ID mapping between tmux native IDs and structured IDs
 *
 * Problem: Tmux returns pane IDs like "%3" but we need predictable IDs like "session:0.0"
 * Solution: Maintain bidirectional mapping and provide resolution methods
 */

import type { Logger } from './logger.js';

export interface PaneMapping {
  /** Tmux native ID (e.g., "%3") */
  nativeId: string;
  /** Structured ID (e.g., "session_name:0.0") */
  structuredId: string;
  /** Session name */
  sessionName: string;
  /** Window index */
  windowIndex: number;
  /** Pane index within window */
  paneIndex: number;
  /** Last seen timestamp for cleanup */
  lastSeen: Date;
}

export class PaneIdResolver {
  private nativeToStructured = new Map<string, PaneMapping>();
  private structuredToNative = new Map<string, PaneMapping>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private logger: Logger,
    private cleanupIntervalMs: number = 30 * 60 * 1000 // 30 minutes
  ) {
    this.startCleanupTimer();
  }

  /**
   * Register a pane mapping from tmux list-panes output
   */
  registerPane(
    nativeId: string,
    sessionName: string,
    windowIndex: number,
    paneIndex: number
  ): string {
    const structuredId = this.buildStructuredId(sessionName, windowIndex, paneIndex);
    const mapping: PaneMapping = {
      nativeId,
      structuredId,
      sessionName,
      windowIndex,
      paneIndex,
      lastSeen: new Date(),
    };

    // Clean up old mappings for this position
    const existingStructured = this.structuredToNative.get(structuredId);
    if (existingStructured && existingStructured.nativeId !== nativeId) {
      this.nativeToStructured.delete(existingStructured.nativeId);
    }

    // Register new mapping
    this.nativeToStructured.set(nativeId, mapping);
    this.structuredToNative.set(structuredId, mapping);

    this.logger.debug(`Registered pane mapping: ${nativeId} <-> ${structuredId}`);
    return structuredId;
  }

  /**
   * Resolve any pane ID format to tmux native ID for command execution
   */
  resolveToNative(paneId: string): string {
    // If it's already a native ID, return as-is
    if (paneId.startsWith('%')) {
      this.updateLastSeen(paneId);
      return paneId;
    }

    // Try to resolve structured ID to native
    const mapping = this.structuredToNative.get(paneId);
    if (mapping) {
      this.updateLastSeen(mapping.nativeId);
      return mapping.nativeId;
    }

    // If it looks like a structured ID but not found, try to parse and find
    if (paneId.includes(':') && paneId.includes('.')) {
      const resolvedNative = this.attemptStructuredResolution(paneId);
      if (resolvedNative) {
        return resolvedNative;
      }
    }

    // Fallback: assume it's a valid tmux target (e.g., "session:0.0")
    this.logger.warn(`Unknown pane ID format: ${paneId}, attempting direct use`);
    return paneId;
  }

  /**
   * Resolve any pane ID format to structured ID for API responses
   */
  resolveToStructured(paneId: string): string {
    // If it's already structured, return as-is
    if (!paneId.startsWith('%')) {
      return paneId;
    }

    // Try to resolve native ID to structured
    const mapping = this.nativeToStructured.get(paneId);
    if (mapping) {
      this.updateLastSeen(paneId);
      return mapping.structuredId;
    }

    // Fallback: return the native ID (not ideal but functional)
    this.logger.warn(`No structured mapping found for native ID: ${paneId}`);
    return paneId;
  }

  /**
   * Get all mappings for a session (useful for cleanup)
   */
  getSessionMappings(sessionName: string): PaneMapping[] {
    return Array.from(this.nativeToStructured.values())
      .filter(mapping => mapping.sessionName === sessionName);
  }

  /**
   * Remove all mappings for a session
   */
  clearSession(sessionName: string): void {
    const mappings = this.getSessionMappings(sessionName);
    for (const mapping of mappings) {
      this.nativeToStructured.delete(mapping.nativeId);
      this.structuredToNative.delete(mapping.structuredId);
    }
    this.logger.debug(`Cleared ${mappings.length} mappings for session: ${sessionName}`);
  }

  /**
   * Get statistics about current mappings
   */
  getStats(): {
    totalMappings: number;
    sessionCount: number;
    oldestMapping: Date | null;
    newestMapping: Date | null;
  } {
    const mappings = Array.from(this.nativeToStructured.values());
    const sessions = new Set(mappings.map(m => m.sessionName));

    let oldest: Date | null = null;
    let newest: Date | null = null;

    for (const mapping of mappings) {
      if (!oldest || mapping.lastSeen < oldest) oldest = mapping.lastSeen;
      if (!newest || mapping.lastSeen > newest) newest = mapping.lastSeen;
    }

    return {
      totalMappings: mappings.length,
      sessionCount: sessions.size,
      oldestMapping: oldest,
      newestMapping: newest,
    };
  }

  /**
   * Build structured ID from components
   */
  private buildStructuredId(sessionName: string, windowIndex: number, paneIndex: number): string {
    // Use consistent format: session_name:window.pane
    return `${sessionName}:${windowIndex}.${paneIndex}`;
  }

  /**
   * Try to find native ID from structured ID pattern
   */
  private attemptStructuredResolution(structuredId: string): string | null {
    const parts = structuredId.split(':');
    if (parts.length !== 2) return null;

    const [sessionName, windowPane] = parts;
    const windowPaneParts = windowPane.split('.');
    if (windowPaneParts.length !== 2) return null;

    const windowIndex = parseInt(windowPaneParts[0], 10);
    const paneIndex = parseInt(windowPaneParts[1], 10);

    if (isNaN(windowIndex) || isNaN(paneIndex)) return null;

    // Look for any mapping with same session and indices
    for (const mapping of this.nativeToStructured.values()) {
      if (
        mapping.sessionName === sessionName &&
        mapping.windowIndex === windowIndex &&
        mapping.paneIndex === paneIndex
      ) {
        return mapping.nativeId;
      }
    }

    return null;
  }

  /**
   * Update last seen timestamp for a native ID
   */
  private updateLastSeen(nativeId: string): void {
    const mapping = this.nativeToStructured.get(nativeId);
    if (mapping) {
      mapping.lastSeen = new Date();
    }
  }

  /**
   * Clean up old mappings periodically
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldMappings();
    }, this.cleanupIntervalMs);
  }

  /**
   * Remove mappings older than 1 hour (session probably dead)
   */
  private cleanupOldMappings(): void {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    let cleanedCount = 0;

    for (const [nativeId, mapping] of this.nativeToStructured.entries()) {
      if (mapping.lastSeen < cutoff) {
        this.nativeToStructured.delete(nativeId);
        this.structuredToNative.delete(mapping.structuredId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} old pane mappings`);
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.nativeToStructured.clear();
    this.structuredToNative.clear();
  }
}