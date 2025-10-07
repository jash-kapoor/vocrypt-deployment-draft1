#!/usr/bin/env bash
# This line ensures that the script will exit immediately if any command fails.
set -o errexit

echo "--- Initializing Git Submodules (like ggwave)... ---"
# This is the new command that downloads the submodule content.
git submodule update --init --recursive

echo "--- Installing native dependencies... ---"
apt-get update && apt-get install -y cmake ffmpeg

echo "--- Building ggwave binaries... ---"
cd ggwave

# This check should now pass because the files have been downloaded.
if [ ! -f CMakeLists.txt ]; then
  echo "ERROR: CMakeLists.txt not found in the ggwave directory!"
  exit 1
fi

cmake -S . -B build && cmake --build build -j
cd ..

echo "--- Installing server dependencies... ---"
cd app/server
npm install

echo "--- Build script finished successfully! ---"