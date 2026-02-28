#!/bin/bash
set -euo pipefail

echo "Stopping Rig services..."

# Stop systemd user services (production)
if systemctl --user is-active rig-server &>/dev/null || systemctl --user is-active rig-operator &>/dev/null; then
	systemctl --user stop rig-server rig-operator 2>/dev/null || true
	echo "  ✓ systemd services stopped"
fi

# Kill any start.sh-spawned processes (dev/foreground mode)
KILLED=0
for proc in "node dist/index.js" "node dist/src/index.js"; do
	pids=$(pgrep -f "$proc" 2>/dev/null || true)
	if [[ -n "$pids" ]]; then
		echo "$pids" | xargs kill 2>/dev/null || true
		KILLED=1
	fi
done

if [[ "$KILLED" -eq 1 ]]; then
	echo "  ✓ foreground processes killed"
fi

echo "Rig stopped."
