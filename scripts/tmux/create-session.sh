#!/bin/bash

# Create tmux session helper script
# Usage: create-session.sh <session_name> [working_directory] [initial_command]

set -e

SESSION_NAME="$1"
WORKING_DIR="${2:-$(pwd)}"
INITIAL_CMD="$3"

if [ -z "$SESSION_NAME" ]; then
    echo "Error: Session name is required"
    echo "Usage: $0 <session_name> [working_directory] [initial_command]"
    exit 1
fi

# Check if session already exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Error: Session '$SESSION_NAME' already exists"
    exit 1
fi

# Create new session
echo "Creating tmux session: $SESSION_NAME"
echo "Working directory: $WORKING_DIR"

if [ -n "$INITIAL_CMD" ]; then
    echo "Initial command: $INITIAL_CMD"
    tmux new-session -d -s "$SESSION_NAME" -c "$WORKING_DIR" "$INITIAL_CMD"
else
    tmux new-session -d -s "$SESSION_NAME" -c "$WORKING_DIR"
fi

echo "Session '$SESSION_NAME' created successfully"
echo "Attach with: tmux attach-session -t $SESSION_NAME"