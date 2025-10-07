#!/usr/bin/env bash
# This line ensures that the script will exit immediately if any command fails.
set -o errexit

echo "--- Installing native dependencies... ---"
apt-get update && apt-get install -y cmake ffmpeg

echo "--- Building ggwave binaries... ---"
# Navigate into the ggwave directory.
cd ggwave

# Verify that the required build file exists before trying to run cmake.
if [ ! -f CMakeLists.txt ]; then
  echo "ERROR: CMakeLists.txt not found in the ggwave directory!"
  exit 1
fi

# Run the build commands. The '&&' ensures they run in sequence and stop on failure.
cmake -S . -B build && cmake --build build -j

# Navigate back to the root directory
cd ..

echo "--- Installing server dependencies... ---"
cd app/server
npm install

echo "--- Build script finished successfully! ---"