#!/bin/bash
set -euo pipefail

# Ensure we are in the project root
cd "$(dirname "$0")"

echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

echo "Building server..."
cd server
npm install
npm run build
cd ..

echo "Building operator..."
cd operator
npm install
npm run build
cd ..

SERVER_PID=""
OPERATOR_PID=""
STACK_EXIT_CODE=0
SHUTTING_DOWN=0

cleanup() {
	if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
		kill "${SERVER_PID}" 2>/dev/null || true
	fi
	if [[ -n "${OPERATOR_PID}" ]] && kill -0 "${OPERATOR_PID}" 2>/dev/null; then
		kill "${OPERATOR_PID}" 2>/dev/null || true
	fi
}

capture_exit_code() {
	local pid="$1"
	if wait "${pid}"; then
		STACK_EXIT_CODE=0
	else
		STACK_EXIT_CODE=$?
	fi
}

trap 'SHUTTING_DOWN=1; cleanup' INT TERM

echo "Starting Rig server..."
(cd server && npm start) &
SERVER_PID=$!

echo "Starting Rig operator..."
(cd operator && npm start) &
OPERATOR_PID=$!

echo "Rig stack is running (server + operator). Press Ctrl+C to stop."

while true; do
	if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
		if [[ "${SHUTTING_DOWN}" -eq 0 ]]; then
			capture_exit_code "${SERVER_PID}"
			echo "Rig server exited with status ${STACK_EXIT_CODE}. Stopping operator..."
		fi
		break
	fi
	if ! kill -0 "${OPERATOR_PID}" 2>/dev/null; then
		if [[ "${SHUTTING_DOWN}" -eq 0 ]]; then
			capture_exit_code "${OPERATOR_PID}"
			echo "Rig operator exited with status ${STACK_EXIT_CODE}. Stopping server..."
		fi
		break
	fi
	sleep 1
done

cleanup
wait "${SERVER_PID}" 2>/dev/null || true
wait "${OPERATOR_PID}" 2>/dev/null || true
exit "${STACK_EXIT_CODE}"
