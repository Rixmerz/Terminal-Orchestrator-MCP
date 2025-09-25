#!/bin/bash

# Installation script for terminal-orchestrator-mcp
# This script installs dependencies and sets up the MCP server

set -e

echo "🚀 Installing terminal-orchestrator-mcp..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please install Node.js 18+ first."
    exit 1
fi

echo "✅ Node.js version: $NODE_VERSION"

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "❌ tmux is not installed. Installing tmux..."

    # Detect OS and install tmux
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install tmux
        else
            echo "❌ Homebrew not found. Please install tmux manually:"
            echo "   brew install tmux"
            exit 1
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v apt-get &> /dev/null; then
            sudo apt-get update && sudo apt-get install -y tmux
        elif command -v yum &> /dev/null; then
            sudo yum install -y tmux
        elif command -v pacman &> /dev/null; then
            sudo pacman -S tmux
        else
            echo "❌ Could not detect package manager. Please install tmux manually."
            exit 1
        fi
    else
        echo "❌ Unsupported OS. Please install tmux manually."
        exit 1
    fi
fi

echo "✅ tmux is installed"

# Install npm dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Build the project
echo "🔨 Building TypeScript project..."
npm run build

# Make scripts executable
echo "🔧 Setting up shell scripts..."
chmod +x scripts/tmux/*.sh
chmod +x scripts/install.sh

# Create logs directory
mkdir -p logs

# Create MCP configuration template
echo "📝 Creating MCP configuration template..."
cat > mcp-config.template.json << 'EOF'
{
  "mcpServers": {
    "terminal-orchestrator-mcp": {
      "command": "node",
      "args": ["./dist/index.js"],
      "cwd": "./",
      "env": {
        "LOG_LEVEL": "info",
        "LOG_DIRECTORY": "./logs",
        "MAX_LOG_SIZE": "104857600",
        "SESSION_TIMEOUT": "86400000"
      }
    }
  }
}
EOF

echo ""
echo "🎉 Installation complete!"
echo ""
echo "📋 Next steps:"
echo "1. Copy mcp-config.template.json to your Claude configuration"
echo "2. Update the 'cwd' path to the absolute path of this directory"
echo "3. Run the server: npm start"
echo ""
echo "🔧 Available commands:"
echo "  npm start       - Start the MCP server"
echo "  npm run dev     - Start in development mode with auto-reload"
echo "  npm test        - Run tests"
echo "  npm run lint    - Run linting"
echo ""
echo "📖 Usage:"
echo "  The server provides tools for:"
echo "  - Session management: tmux:create-session, tmux:list-sessions"
echo "  - Log analysis: logs:summarize, logs:search, logs:get-recent"
echo "  - Process monitoring: process:list-ports, process:multi-kill"
echo "  - Error detection: errors:watch, errors:summary, errors:analyze"
echo ""
echo "✨ Happy coding with intelligent tmux orchestration!"