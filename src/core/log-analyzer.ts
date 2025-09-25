/**
 * Log Analyzer - Pattern matching and log summarization
 */

import { readFile, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type {
  LogEntry,
  LogSummary,
  ErrorEntry,
  ErrorPattern,
  TmuxPane
} from '../types/index.js';
import type { Logger } from '../utils/logger.js';

export class LogAnalyzer {
  private errorPatterns: ErrorPattern[] = [
    {
      name: 'typescript',
      regex: /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*TS\d+:\s*(.+)$/i,
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
      name: 'javascript',
      regex: /^(.+?):(\d+):(\d+):\s*(Error|SyntaxError|TypeError|ReferenceError):\s*(.+)$/i,
      type: 'error',
      language: 'javascript',
      captureGroups: {
        file: 1,
        line: 2,
        column: 3,
        message: 5,
      },
    },
    {
      name: 'python',
      regex: /File "(.+?)", line (\d+).*?\n(.+?Error): (.+)/s,
      type: 'error',
      language: 'python',
      captureGroups: {
        file: 1,
        line: 2,
        message: 4,
      },
    },
    {
      name: 'rust',
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
      name: 'go',
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
      name: 'general_error',
      regex: /(ERROR|FAIL|Exception|Error:|Failed)/i,
      type: 'error',
      captureGroups: {
        message: 0,
      },
    },
    {
      name: 'general_warning',
      regex: /(WARN|Warning|Deprecated|Notice)/i,
      type: 'warning',
      captureGroups: {
        message: 0,
      },
    },
    {
      name: 'npm_error',
      regex: /npm ERR!\s*(.+)/i,
      type: 'error',
      language: 'npm',
      captureGroups: {
        message: 1,
      },
    },
    {
      name: 'docker_error',
      regex: /docker: Error response from daemon: (.+)/i,
      type: 'error',
      language: 'docker',
      captureGroups: {
        message: 1,
      },
    },
  ];

  constructor(private logger: Logger) {}

  async analyzeLogFile(filePath: string, maxLines: number = 1000): Promise<LogSummary> {
    try {
      const stats = await stat(filePath);
      const errors: ErrorEntry[] = [];
      const warnings: ErrorEntry[] = [];
      const patterns: Record<string, number> = {};

      let totalLines = 0;
      let timeRange = {
        start: new Date(),
        end: new Date(),
      };

      // Read file line by line to handle large files efficiently
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      const lines: string[] = [];
      let lineCount = 0;

      for await (const line of rl) {
        totalLines++;

        // Keep only recent lines to avoid memory issues
        if (lines.length >= maxLines) {
          lines.shift();
        }
        lines.push(line);

        // Extract timestamp if possible
        const timestamp = this.extractTimestamp(line);
        if (timestamp) {
          if (lineCount === 0) timeRange.start = timestamp;
          timeRange.end = timestamp;
        }

        // Check for errors and warnings
        const errorEntry = this.matchErrorPatterns(line, filePath, lineCount);
        if (errorEntry) {
          if (errorEntry.type === 'error') {
            errors.push(errorEntry);
          } else if (errorEntry.type === 'warning') {
            warnings.push(errorEntry);
          }

          // Count pattern matches
          const patternName = this.getMatchingPatternName(line);
          if (patternName) {
            patterns[patternName] = (patterns[patternName] || 0) + 1;
          }
        }

        lineCount++;
      }

      return {
        paneId: this.extractPaneIdFromPath(filePath),
        totalLines,
        errors: errors.length,
        warnings: warnings.length,
        timeRange,
        errorSamples: [...errors.slice(-5), ...warnings.slice(-3)], // Last 5 errors + 3 warnings
        patterns,
      };

    } catch (error) {
      this.logger.error(`Failed to analyze log file ${filePath}:`, error);
      throw error;
    }
  }

  async getRecentLogs(filePath: string, lineCount: number = 50): Promise<string[]> {
    try {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      const lines: string[] = [];

      for await (const line of rl) {
        if (lines.length >= lineCount) {
          lines.shift();
        }
        lines.push(line);
      }

      return lines;
    } catch (error) {
      this.logger.error(`Failed to get recent logs from ${filePath}:`, error);
      return [];
    }
  }

  async searchLogs(filePath: string, pattern: string, maxResults: number = 100): Promise<string[]> {
    try {
      const regex = new RegExp(pattern, 'i');
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      const matches: string[] = [];

      for await (const line of rl) {
        if (regex.test(line)) {
          matches.push(line);
          if (matches.length >= maxResults) {
            break;
          }
        }
      }

      return matches;
    } catch (error) {
      this.logger.error(`Failed to search logs in ${filePath}:`, error);
      return [];
    }
  }

  private matchErrorPatterns(line: string, filePath: string, lineNumber: number): ErrorEntry | null {
    for (const pattern of this.errorPatterns) {
      const match = line.match(pattern.regex);
      if (match) {
        const groups = pattern.captureGroups;

        return {
          id: `${filePath}:${lineNumber}:${Date.now()}`,
          paneId: this.extractPaneIdFromPath(filePath),
          file: groups.file ? match[groups.file] : undefined,
          line: groups.line ? parseInt(match[groups.line]) : undefined,
          column: groups.column ? parseInt(match[groups.column]) : undefined,
          message: match[groups.message] || line,
          type: pattern.type,
          language: pattern.language,
          timestamp: new Date(),
        };
      }
    }

    return null;
  }

  private getMatchingPatternName(line: string): string | null {
    for (const pattern of this.errorPatterns) {
      if (pattern.regex.test(line)) {
        return pattern.name;
      }
    }
    return null;
  }

  private extractTimestamp(line: string): Date | null {
    // Common timestamp patterns
    const patterns = [
      /\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?)\]/,
      /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?)/,
      /\[(\d{2}:\d{2}:\d{2})\]/,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        try {
          return new Date(match[1]);
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  private extractPaneIdFromPath(filePath: string): string {
    // Extract pane ID from log file path
    // Format: logs/session_window_pane.log
    const basename = filePath.split('/').pop() || '';
    const match = basename.match(/^(.+)\.log$/);
    return match ? match[1] : basename;
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

  getPatterns(): ErrorPattern[] {
    return [...this.errorPatterns];
  }

  async generateSummaryReport(panes: TmuxPane[]): Promise<string> {
    const summaries: LogSummary[] = [];

    for (const pane of panes) {
      if (pane.logFile) {
        try {
          const summary = await this.analyzeLogFile(pane.logFile);
          summaries.push(summary);
        } catch (error) {
          this.logger.warn(`Could not analyze log for pane ${pane.id}:`, error);
        }
      }
    }

    return this.formatSummaryReport(summaries);
  }

  private formatSummaryReport(summaries: LogSummary[]): string {
    const totalErrors = summaries.reduce((sum, s) => sum + s.errors, 0);
    const totalWarnings = summaries.reduce((sum, s) => sum + s.warnings, 0);
    const totalLines = summaries.reduce((sum, s) => sum + s.totalLines, 0);

    let report = `# Log Analysis Summary\n\n`;
    report += `**Total Lines**: ${totalLines}\n`;
    report += `**Total Errors**: ${totalErrors}\n`;
    report += `**Total Warnings**: ${totalWarnings}\n\n`;

    if (summaries.length > 0) {
      report += `## Per-Pane Breakdown\n\n`;

      for (const summary of summaries) {
        report += `### Pane: ${summary.paneId}\n`;
        report += `- Lines: ${summary.totalLines}\n`;
        report += `- Errors: ${summary.errors}\n`;
        report += `- Warnings: ${summary.warnings}\n`;

        if (summary.errorSamples.length > 0) {
          report += `- Recent Issues:\n`;
          for (const error of summary.errorSamples.slice(0, 3)) {
            report += `  - ${error.type}: ${error.message}\n`;
          }
        }

        report += `\n`;
      }
    }

    return report;
  }
}