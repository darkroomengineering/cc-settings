#!/bin/bash
# Encode a frame folder (f_%05d.jpg from rec.js) to a 60 fps master, optionally muxing a WAV. usage: frames2mp4.sh <dir> <out.mp4> [audio.wav]
if [ -n "$3" ]; then ffmpeg -v error -y -framerate 60 -i "$1/f_%05d.jpg" -i "$3" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -c:a aac -b:a 256k -shortest -movflags +faststart "$2"
else ffmpeg -v error -y -framerate 60 -i "$1/f_%05d.jpg" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart "$2"; fi
