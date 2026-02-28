#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

npm install
npm run build
npm start
