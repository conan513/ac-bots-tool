#!/bin/bash
cd "$(dirname "$0")"

echo "==================================================="
echo "  AzerothCore & mod-playerbots Build Dashboard"
echo "==================================================="
echo

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "HIBA: A Node.js nincs telepítve! Kérlek telepítsd a nodejs.org-ról."
    exit 1
fi

# Install root dependencies
if [ ! -d "node_modules" ]; then
    echo "[1/3] Rendszer függőségek telepítése..."
    npm install
    echo
else
    echo "[1/3] Rendszer függőségek már telepítve vannak."
fi

# Install frontend dependencies
if [ ! -d "frontend/node_modules" ]; then
    echo "[2/3] UI függőségek telepítése..."
    cd frontend
    npm install
    cd ..
    echo
else
    echo "[2/3] UI függőségek már telepítve vannak."
fi

# Build frontend
if [ ! -d "frontend/dist" ]; then
    echo "[3/3] UI forráskod fordítása..."
    npm run build-frontend
    echo
else
    echo "[3/3] UI már le van fordítva."
fi

echo
echo "Indítás folyamatban..."
echo "A böngésző megnyílik a http://localhost:3000 címen."
echo
npm start
