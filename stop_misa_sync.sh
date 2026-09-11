#!/bin/bash
PID=$(pgrep -f "misa_sync_runner.py")
if [ -n "$PID" ]; then
  kill -9 $PID
  echo "Đã dừng MISA Sync Runner (PID: $PID)."
else
  echo "MISA Sync Runner hiện không chạy."
fi
