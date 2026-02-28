#!/usr/bin/env bash
# deploy.sh — Build rig and deploy to ~/rig-deploy
# Usage: ./deploy.sh [--no-restart]
# After first run, changes go live with: systemctl --user restart rig-server
#                                         systemctl --user restart rig-operator
set -euo pipefail

DEPLOY_DIR="$HOME/rig-deploy"
RIG_DIR="$(cd "$(dirname "$0")" && pwd)"

NO_RESTART=0
for arg in "$@"; do
  [[ "$arg" == "--no-restart" ]] && NO_RESTART=1
done

echo "==> Building frontend..."
cd "$RIG_DIR/frontend"
npm install --silent
npm run build

echo "==> Building server..."
cd "$RIG_DIR/server"
npm install --silent
npm run build

echo "==> Building operator..."
cd "$RIG_DIR/operator"
npm install --silent
npm run build

echo "==> Deploying to $DEPLOY_DIR ..."
mkdir -p "$DEPLOY_DIR/server/dist" "$DEPLOY_DIR/operator/dist" "$DEPLOY_DIR/frontend/dist"

# --- server ---
rsync -a --delete \
  "$RIG_DIR/server/dist/" \
  "$DEPLOY_DIR/server/dist/"

rsync -a --delete \
  "$RIG_DIR/server/node_modules/" \
  "$DEPLOY_DIR/server/node_modules/"

cp "$RIG_DIR/server/package.json" "$DEPLOY_DIR/server/package.json"

# Copy built frontend into deploy dir so the server can serve it
rsync -a --delete \
  "$RIG_DIR/frontend/dist/" \
  "$DEPLOY_DIR/frontend/dist/"

# --- operator ---
rsync -a --delete \
  "$RIG_DIR/operator/dist/" \
  "$DEPLOY_DIR/operator/dist/"

rsync -a --delete \
  "$RIG_DIR/operator/node_modules/" \
  "$DEPLOY_DIR/operator/node_modules/"

cp "$RIG_DIR/operator/package.json" "$DEPLOY_DIR/operator/package.json"

echo "==> Installing systemd user services..."
SYSTEMD_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_DIR"

# Resolve current node binary directory (survives nvm version changes)
NODE_BIN_DIR="$(dirname "$(which node)")"
echo "    Using node from: $NODE_BIN_DIR"

sed "s|__NODE_BIN_DIR__|${NODE_BIN_DIR}|g" "$RIG_DIR/ops/rig-server.service"   > "$SYSTEMD_DIR/rig-server.service"
sed "s|__NODE_BIN_DIR__|${NODE_BIN_DIR}|g" "$RIG_DIR/ops/rig-operator.service" > "$SYSTEMD_DIR/rig-operator.service"

systemctl --user daemon-reload
systemctl --user enable rig-server.service rig-operator.service

if [[ $NO_RESTART -eq 0 ]]; then
  echo "==> Restarting services..."
  systemctl --user restart rig-server.service
  systemctl --user restart rig-operator.service
  echo ""
  echo "==> Status:"
  systemctl --user status rig-server.service  --no-pager -l || true
  systemctl --user status rig-operator.service --no-pager -l || true
fi

echo ""
echo "Done! Deploy dir: $DEPLOY_DIR"
echo ""
echo "Commands:"
echo "  systemctl --user restart rig-server    # restart server + frontend"
echo "  systemctl --user restart rig-operator  # restart operator"
echo "  systemctl --user status  rig-server"
echo "  systemctl --user status  rig-operator"
echo "  journalctl --user -fu rig-server       # follow server logs"
echo "  journalctl --user -fu rig-operator     # follow operator logs"
