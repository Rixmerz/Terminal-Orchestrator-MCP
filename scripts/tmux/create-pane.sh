#!/bin/bash

# Create tmux pane helper script
# Usage: create-pane.sh <session_name> [window_index] [command]

set -e

SESSION_NAME="$1"
WINDOW_INDEX="${2:-0}"
COMMAND="$3"

if [ -z "$SESSION_NAME" ]; then
    echo "Error: Session name is required"
    echo "Usage: $0 <session_name> [window_index] [command]"
    exit 1
fi

# Check if session exists
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Error: Session '$SESSION_NAME' does not exist"
    exit 1
fi

# Create new pane by splitting current window
echo "Creating new pane in session: $SESSION_NAME:$WINDOW_INDEX"

# Split window to create new pane
tmux split-window -t "$SESSION_NAME:$WINDOW_INDEX"

# If command is provided, send it to the new pane
if [ -n "$COMMAND" ]; then
    echo "Executing command in new pane: $COMMAND"
    # Get the pane index of the last created pane
    PANE_INDEX=$(tmux list-panes -t "$SESSION_NAME:$WINDOW_INDEX" -F "#{pane_index}" | tail -1)
    tmux send-keys -t "$SESSION_NAME:$WINDOW_INDEX.$PANE_INDEX" "$COMMAND" Enter
fi

echo "Pane created successfully in $SESSION_NAME:$WINDOW_INDEX"