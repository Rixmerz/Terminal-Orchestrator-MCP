#!/bin/bash

# Setup logging for tmux session/pane
# Usage: setup-logging.sh <session_name> <log_directory>

set -e

SESSION_NAME="$1"
LOG_DIR="${2:-./logs}"

if [ -z "$SESSION_NAME" ]; then
    echo "Error: Session name is required"
    echo "Usage: $0 <session_name> [log_directory]"
    exit 1
fi

# Check if session exists
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Error: Session '$SESSION_NAME' does not exist"
    exit 1
fi

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

echo "Setting up logging for session: $SESSION_NAME"
echo "Log directory: $LOG_DIR"

# Get all windows and panes for the session
tmux list-panes -s -t "$SESSION_NAME" -F "#{session_name}:#{window_index}.#{pane_index}" | while read PANE_ID; do
    # Extract session, window, and pane info
    SESSION=$(echo "$PANE_ID" | cut -d: -f1)
    WINDOW_PANE=$(echo "$PANE_ID" | cut -d: -f2)
    WINDOW_INDEX=$(echo "$WINDOW_PANE" | cut -d. -f1)
    PANE_INDEX=$(echo "$WINDOW_PANE" | cut -d. -f2)

    # Create log file name
    LOG_FILE="$LOG_DIR/${SESSION}_${WINDOW_INDEX}_${PANE_INDEX}.log"

    echo "Setting up logging for pane $PANE_ID -> $LOG_FILE"

    # Start pipe-pane for this pane
    tmux pipe-pane -t "$PANE_ID" "cat >> $LOG_FILE"
done

echo "Logging setup complete for session: $SESSION_NAME"
echo "Log files are being written to: $LOG_DIR"
echo "To stop logging: tmux pipe-pane -t <pane_id>"