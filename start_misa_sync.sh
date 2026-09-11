#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"
PID=$(pgrep -f "misa_sync_runner.py")
if [ -n "$PID" ]; then
  echo "MISA Sync Runner đang chạy với PID: $PID"
else
  nohup python3 -u "$DIR/misa_sync_runner.py" > "$DIR/misa_sync.log" 2>&1 &
  echo "Đã khởi động MISA Sync Runner nền thành công! PID: $!"
fi
