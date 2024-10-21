#!/bin/bash

echo "Stopping current server instance..."
pkill -f "node server.js"

echo "Installing dependencies..."
npm install

echo "Building project..."
npm run build

echo "Starting server..."
node server.js &

echo "Build refreshed and server restarted!"
echo "Please clear your browser cache and refresh the page."