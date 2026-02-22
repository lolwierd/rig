#!/bin/bash
set -e

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

echo "Starting Rig..."
cd server
npm start
