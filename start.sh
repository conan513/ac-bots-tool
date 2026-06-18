#!/bin/bash
cd "$(dirname "$0")"

echo "==================================================="
echo "  AzerothCore & mod-playerbots Build Dashboard"
echo "==================================================="
echo

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed! Please install it from nodejs.org."
    exit 1
fi

# Install root dependencies
if [ ! -d "node_modules" ]; then
    echo "[1/3] Installing system dependencies..."
    npm install
    echo
else
    echo "[1/3] System dependencies are already installed."
fi

# Install frontend dependencies
if [ ! -d "frontend/node_modules" ]; then
    echo "[2/3] Installing UI dependencies..."
    cd frontend
    npm install
    cd ..
    echo
else
    echo "[2/3] UI dependencies are already installed."
fi

# Always build frontend on startup
echo "[3/3] Building UI source code..."
npm run build-frontend
echo

echo
echo "Launching..."
echo "The browser will open at http://localhost:3000"
echo
npm start
