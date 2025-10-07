#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Installing native dependencies..."
apt-get update && apt-get install -y cmake ffmpeg

echo "Building ggwave binaries..."
# We're already at the root, so we just enter the ggwave dir
cd ggwave
cmake -S . -B build && cmake --build build -j
cd .. # Go back to the root directory

echo "Installing server dependencies..."
# Now go into the server folder to run npm install
cd app/server
npm install
