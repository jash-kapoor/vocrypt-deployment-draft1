#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Installing native dependencies..."
# Install cmake and ffmpeg
apt-get update && apt-get install -y cmake ffmpeg

echo "Building ggwave binaries..."
# Navigate to the ggwave directory from the repo root and build for Linux
cd ../../ggwave
cmake -S . -B build && cmake --build build -j

echo "Installing server dependencies..."
# Navigate back to the server directory (our root directory)
cd ../app/server
npm install
