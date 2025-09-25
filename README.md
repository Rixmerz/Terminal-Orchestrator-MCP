# Terminal Orchestrator MCP

An intelligent terminal orchestrator MCP server that transforms tmux into a powerful development environment with real-time monitoring, log analysis, and process management capabilities.

## Features

### 🎯 Core Capabilities

- **Persistent Terminal Management**: Create and manage tmux sessions that survive MCP restarts
- **Real-time Log Capture**: Automatic log capture with intelligent analysis and pattern matching
- **Process & Port Monitoring**: Monitor system resources, ports, and process health
- **Automated Error Detection**: Language-specific error detection with real-time alerts
- **Structured JSON-RPC 2.0 API**: Clean, well-documented API for AI agent integration

### 🛠️ Tool Categories

#### Session Management (`tmux:*`)
- `tmux:create-session` - Create new tmux sessions with custom configurations
- `tmux:create-pane` - Add panes to existing sessions
- `tmux:execute-command` - Run commands in specific panes
- `tmux:list-sessions` - Get all active sessions and their details
- `tmux:get-session` - Detailed information about a specific session
- `tmux:destroy-session` - Clean up sessions and resources

#### Log Analysis (`logs:*`)
- `logs:get-recent` - Get recent log entries from any pane
- `logs:summarize` - AI-powered log analysis with error/warning counts
- `logs:search` - Search logs with regex patterns
- `logs:watch` - Real-time log monitoring
- `logs:generate-report` - Comprehensive log analysis reports

#### Process Management (`process:*`)
- `process:list-ports` - Show open ports and associated processes
- `process:multi-kill` - Kill multiple processes by pattern
- `process:monitor` - Real-time process monitoring with resource usage
- `process:restart` - Intelligent process restart with health checks
- `process:port-monitor` - Monitor specific ports for activity
- `process:system-load` - System load averages and top processes

#### Error Detection (`errors:*`)
- `errors:watch` - Start real-time error detection for panes
- `errors:summary` - Get error statistics and trends
- `errors:clear` - Clear error cache
- `errors:analyze` - Deep error pattern analysis
- `errors:add-pattern` - Add custom error detection patterns
- `errors:stop-watch` - Stop error monitoring

## Installation

### Prerequisites

- Node.js 18 or higher
- tmux 2.0 or higher
- Unix-like operating system (macOS, Linux)

### Quick Install

```bash
# Clone or create the project
mkdir terminal-orchestrator-mcp && cd terminal-orchestrator-mcp

# Run the installation script
./scripts/install.sh
```

### Manual Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Make scripts executable
chmod +x scripts/tmux/*.sh scripts/install.sh

# Create directories
mkdir -p logs storage
```

## Configuration

### MCP Configuration

Add to your Claude configuration file:

```json
{
  "mcpServers": {
    "terminal-orchestrator-mcp": {
      "command": "node",
      "args": ["./dist/index.js"],
      "cwd": "/absolute/path/to/terminal-orchestrator-mcp",
      "env": {
        "LOG_LEVEL": "info",
        "LOG_DIRECTORY": "./logs",
        "MAX_LOG_SIZE": "104857600",
        "SESSION_TIMEOUT": "86400000",
        "ENABLE_LOGGING": "true",
        "STORAGE_DIRECTORY": "./storage"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `LOG_DIRECTORY` | `./logs` | Directory for log file storage |
| `MAX_LOG_SIZE` | `104857600` | Maximum log file size (100MB) |
| `SESSION_TIMEOUT` | `86400000` | Session timeout in milliseconds (24h) |
| `ENABLE_LOGGING` | `true` | Enable automatic log capture |
| `STORAGE_DIRECTORY` | `./storage` | Session persistence directory |

## Usage Examples

### Basic Session Management

```typescript
// Create a development session
await callTool('tmux:create-session', {
  name: 'dev-session',
  workingDirectory: '/path/to/project',
  windows: [
    {
      name: 'editor',
      panes: [
        { command: 'code .' }
      ]
    },
    {
      name: 'servers',
      panes: [
        { command: 'npm run dev' },
        { command: 'npm run test:watch' }
      ]
    }
  ]
});

// List all active sessions
const sessions = await callTool('tmux:list-sessions', {});
```

### Log Analysis

```typescript
// Get recent logs from a pane
const logs = await callTool('logs:get-recent', {
  paneId: 'dev-session:1.0',
  lines: 100
});

// Analyze logs for errors and patterns
const summary = await callTool('logs:summarize', {
  paneId: 'dev-session:1.0',
  maxLines: 1000
});

// Search for specific patterns
const errors = await callTool('logs:search', {
  paneId: 'dev-session:1.0',
  pattern: 'ERROR|Exception|Failed',
  caseSensitive: false
});
```

### Process Monitoring

```typescript
// List all open ports
const ports = await callTool('process:list-ports', {
  includeProcessInfo: true
});

// Monitor processes by pattern
const processes = await callTool('process:monitor', {
  pattern: 'node',
  sortBy: 'cpu',
  limit: 10
});

// Kill processes matching pattern
const result = await callTool('process:multi-kill', {
  pattern: 'old-server',
  dryRun: true // Check what would be killed first
});
```

### Error Detection

```typescript
// Start error watching for a development pane
await callTool('errors:watch', {
  paneId: 'dev-session:1.0',
  languages: ['typescript', 'javascript'],
  watchDuration: 3600 // 1 hour
});

// Get error summary
const errorSummary = await callTool('errors:summary', {
  timeRange: 'hour',
  includeWarnings: true
});

// Analyze error patterns
const analysis = await callTool('errors:analyze', {
  paneId: 'dev-session:1.0',
  includePatterns: true,
  includeTrends: true
});
```

## Architecture

### Core Components

```
src/
├── core/                   # Core business logic
│   ├── tmux-manager.ts    # Tmux session management
│   ├── log-analyzer.ts    # Log parsing and analysis
│   ├── process-monitor.ts # Process and port monitoring
│   └── error-watcher.ts   # Real-time error detection
├── tools/                 # MCP tool implementations
│   ├── session-tools.ts   # Session management tools
│   ├── log-tools.ts       # Log analysis tools
│   ├── process-tools.ts   # Process management tools
│   └── error-tools.ts     # Error detection tools
├── storage/               # Data persistence
│   └── session-store.ts   # Session metadata storage
├── utils/                 # Utilities
│   ├── logger.ts          # Logging system
│   ├── errors.ts          # Error handling
│   └── file-watcher.ts    # File monitoring
└── types/                 # TypeScript definitions
    └── index.ts           # Type definitions
```

### Data Flow

1. **Session Creation**: MCP tools → TmuxManager → tmux commands → log capture setup
2. **Log Analysis**: File watchers → LogAnalyzer → pattern matching → structured output
3. **Error Detection**: ErrorWatcher → real-time monitoring → pattern matching → alerts
4. **Process Monitoring**: ProcessMonitor → system commands → structured data
5. **Persistence**: SessionStore → JSON storage → session recovery

## Development

### Scripts

```bash
npm run dev        # Development mode with auto-reload
npm run build      # Build TypeScript to JavaScript
npm run test       # Run test suite
npm run test:watch # Run tests in watch mode
npm run lint       # Run ESLint
npm run clean      # Clean build directory
```

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test -- --coverage

# Run specific test file
npm test -- tmux-manager.test.ts
```

### Adding Custom Error Patterns

```typescript
// Add a custom pattern for detecting API errors
await callTool('errors:add-pattern', {
  name: 'api-error',
  regex: 'API Error (\\d+): (.+)',
  type: 'error',
  language: 'api',
  captureGroups: {
    message: 2,
    // Custom: status code in group 1
  }
});
```

## Best Practices

### Session Organization

- Use descriptive session names that indicate purpose
- Group related processes in the same session
- Create separate sessions for different projects
- Use meaningful window and pane names

### Log Management

- Enable log rotation for long-running processes
- Use structured logging in your applications
- Monitor log file sizes to prevent disk issues
- Archive old logs regularly

### Error Detection

- Configure language-specific patterns for your stack
- Set up error watching for critical processes
- Review error trends regularly
- Create custom patterns for application-specific errors

### Process Monitoring

- Monitor resource usage regularly
- Set up alerts for high CPU/memory usage
- Use process restart capabilities for fault tolerance
- Keep track of port allocations

## Troubleshooting

### Common Issues

**MCP Server Won't Start**
- Check Node.js version (18+ required)
- Verify tmux is installed and accessible
- Check file permissions on scripts
- Review log files for specific errors

**Sessions Not Persisting**
- Verify storage directory exists and is writable
- Check session timeout configuration
- Review SessionStore logs for errors

**Log Analysis Not Working**
- Ensure log directory exists
- Check file permissions
- Verify tmux pipe-pane is working
- Review error patterns for matches

**Process Monitoring Issues**
- Verify required commands are available (lsof, ps)
- Check system permissions
- Review command output format differences across systems

### Debug Mode

Enable debug logging:

```bash
LOG_LEVEL=debug npm start
```

### Health Check

The server provides a health check API:

```typescript
const health = await server.healthCheck();
console.log(health);
// {
//   status: 'healthy',
//   components: { tmuxAvailable: true, storageAccessible: true },
//   stats: { totalSessions: 3, activeSessions: 2 }
// }
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

### Code Style

- Use TypeScript for all new code
- Follow existing naming conventions
- Add JSDoc comments for public APIs
- Write tests for new features
- Use meaningful commit messages

## License

MIT License - see LICENSE file for details.

## Support

- Create issues for bugs or feature requests
- Check existing issues before creating new ones
- Provide detailed reproduction steps
- Include system information and logs

---

**Transform your terminal into an intelligent development environment with terminal-orchestrator-mcp!** 🚀