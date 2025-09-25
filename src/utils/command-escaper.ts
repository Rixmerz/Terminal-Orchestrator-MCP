/**
 * CommandEscaper - Safe command execution for tmux with proper escaping
 *
 * Problem: Commands with quotes, parentheses, and special chars break execution
 * Solution: Proper shell escaping and validation for safe command execution
 */

import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import type { Logger } from './logger.js';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandOptions {
  /** Working directory for command execution */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to validate command for safety */
  validate?: boolean;
}

export class CommandEscaper {
  // Dangerous commands that should be blocked or require validation
  private dangerousCommands = new Set([
    'rm',
    'rmdir',
    'dd',
    'mkfs',
    'fdisk',
    'sudo',
    'su',
    'chmod',
    'chown',
    'kill',
    'killall',
    'pkill',
    'halt',
    'reboot',
    'shutdown',
    'format',
    'del',
    'deltree',
  ]);

  // Commands that are generally safe for development
  private safeDevelopmentCommands = new Set([
    'node',
    'npm',
    'yarn',
    'pnpm',
    'python',
    'python3',
    'pip',
    'cargo',
    'rustc',
    'go',
    'java',
    'javac',
    'tsc',
    'tsx',
    'jest',
    'vitest',
    'mocha',
    'pytest',
    'git',
    'docker',
    'docker-compose',
    'make',
    'cmake',
    'webpack',
    'vite',
    'rollup',
    'esbuild',
    'ls',
    'cat',
    'echo',
    'pwd',
    'cd',
    'mkdir',
    'touch',
    'cp',
    'mv',
    'grep',
    'find',
    'which',
    'whereis',
    'ps',
    'top',
    'htop',
    'curl',
    'wget',
    'ping',
    'netstat',
    'lsof',
  ]);

  constructor(
    private logger: Logger,
    private options: {
      /** Whether to allow dangerous commands (default: false) */
      allowDangerous?: boolean;
      /** Whether to log all executed commands (default: true) */
      logCommands?: boolean;
      /** Default timeout for commands (default: 30s) */
      defaultTimeout?: number;
    } = {}
  ) {
    this.options = {
      allowDangerous: false,
      logCommands: true,
      defaultTimeout: 30000,
      ...options,
    };
  }

  /**
   * Execute a tmux command with proper escaping
   */
  async executeTmuxCommand(
    subcommand: string,
    args: string[] = [],
    options: CommandOptions = {}
  ): Promise<CommandResult> {
    const fullArgs = [subcommand, ...args];
    return this.executeCommand('tmux', fullArgs, {
      validate: true,
      ...options,
    });
  }

  /**
   * Send keys to a tmux pane with proper escaping
   */
  async sendKeysToPane(
    paneId: string,
    command: string,
    options: CommandOptions = {}
  ): Promise<CommandResult> {
    const escapedCommand = this.escapeForTmuxSendKeys(command);

    return this.executeTmuxCommand('send-keys', [
      '-t', paneId,
      escapedCommand,
      'Enter'
    ], options);
  }

  /**
   * Execute a command safely with validation and escaping
   */
  async executeCommand(
    command: string,
    args: string[] = [],
    options: CommandOptions = {}
  ): Promise<CommandResult> {
    const opts = { ...this.options, ...options };

    // Validate command if requested
    if (opts.validate) {
      this.validateCommand(command, args);
    }

    // Log command if enabled
    if (opts.logCommands) {
      this.logger.debug(`Executing command: ${command} ${args.join(' ')}`);
    }

    try {
      const result = await execFileAsync(command, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        timeout: opts.timeout || this.options.defaultTimeout,
        encoding: 'utf8',
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0,
      };
    } catch (error: any) {
      // Handle timeout and other errors
      const exitCode = error.code === 'TIMEOUT' ? 124 : (error.exitCode || 1);

      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode,
      };
    }
  }

  /**
   * Spawn a long-running process with validation
   */
  spawnProcess(
    command: string,
    args: string[] = [],
    options: CommandOptions & {
      /** Whether to pipe stdio to parent process */
      inherit?: boolean;
    } = {}
  ): ChildProcess {
    const opts = { ...this.options, ...options };

    // Validate command if requested
    if (opts.validate) {
      this.validateCommand(command, args);
    }

    // Log command if enabled
    if (opts.logCommands) {
      this.logger.debug(`Spawning process: ${command} ${args.join(' ')}`);
    }

    return spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: opts.inherit ? 'inherit' : 'pipe',
    });
  }

  /**
   * Escape a command string for tmux send-keys
   */
  escapeForTmuxSendKeys(command: string): string {
    // For tmux send-keys, we need to handle several special characters:
    // - Quotes need to be escaped
    // - Semicolons can break commands
    // - Dollar signs for variable expansion
    // - Backticks for command substitution

    return command
      // Escape backslashes first
      .replace(/\\/g, '\\\\')
      // Escape double quotes
      .replace(/"/g, '\\"')
      // Escape single quotes by ending quote, adding escaped quote, starting quote
      .replace(/'/g, "'\"'\"'")
      // Escape dollar signs to prevent variable expansion
      .replace(/\$/g, '\\$')
      // Escape backticks to prevent command substitution
      .replace(/`/g, '\\`')
      // Escape semicolons to prevent command chaining
      .replace(/;/g, '\\;')
      // Escape pipe characters
      .replace(/\|/g, '\\|')
      // Escape ampersands
      .replace(/&/g, '\\&');
  }

  /**
   * Validate a command for safety
   */
  private validateCommand(command: string, args: string[] = []): void {
    const baseCommand = command.split('/').pop() || command;

    // Check if command is dangerous
    if (this.dangerousCommands.has(baseCommand) && !this.options.allowDangerous) {
      throw new Error(`Dangerous command blocked: ${baseCommand}. Use allowDangerous option to override.`);
    }

    // Check for suspicious patterns in arguments
    const allArgs = args.join(' ');

    // Check for potential command injection
    const suspiciousPatterns = [
      /;\s*(rm|del|format)/i,
      /\|\s*(rm|del|format)/i,
      /&&\s*(rm|del|format)/i,
      /\$\([^)]*rm[^)]*\)/i,
      /`[^`]*rm[^`]*`/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(allArgs)) {
        throw new Error(`Suspicious command pattern detected in arguments: ${allArgs}`);
      }
    }

    // Warn about non-development commands
    if (!this.safeDevelopmentCommands.has(baseCommand) && baseCommand !== 'tmux') {
      this.logger.warn(`Executing non-standard development command: ${baseCommand}`);
    }
  }

  /**
   * Create a safe command string for display/logging
   */
  formatCommandForDisplay(command: string, args: string[] = []): string {
    const safeArgs = args.map(arg => {
      // If argument contains spaces or special characters, quote it
      if (/[\s"'`$;&|<>(){}[\]\\*?]/.test(arg)) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    });

    return `${command} ${safeArgs.join(' ')}`;
  }

  /**
   * Test if a command would be safe to execute
   */
  isCommandSafe(command: string, args: string[] = []): {
    safe: boolean;
    reason?: string;
  } {
    try {
      this.validateCommand(command, args);
      return { safe: true };
    } catch (error) {
      return {
        safe: false,
        reason: error instanceof Error ? error.message : 'Unknown validation error',
      };
    }
  }

  /**
   * Get list of allowed safe commands
   */
  getSafeCommands(): string[] {
    return Array.from(this.safeDevelopmentCommands);
  }

  /**
   * Get list of blocked dangerous commands
   */
  getDangerousCommands(): string[] {
    return Array.from(this.dangerousCommands);
  }
}