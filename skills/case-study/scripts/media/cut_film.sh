#!/bin/bash
# Cut a scroll master into named clips (one per chapter and per transition) + N evenly spaced stills.
# usage: cut_film.sh <master.mp4> <clips.txt: lines "name|start|end" in seconds> <out_dir> [stills=24]
set -e
IN=$1; LIST=$2; OUT=$3; N=${4:-24}; mkdir -p "$OUT/clips" "$OUT/stills"
while IFS='|' read -r n a b; do [ -z "$n" ] && continue
  ffmpeg -v error -y -ss $a -to $b -i "$IN" -c:v libx264 -preset medium -crf 17 -pix_fmt yuv420p -c:a aac -b:a 256k \
    -af "afade=t=in:d=0.3,afade=t=out:st=$(echo "$b-$a-0.4" | bc):d=0.4" -movflags +faststart "$OUT/clips/$n.mp4"
done < "$LIST"
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
for i in $(seq 1 $N); do t=$(echo "($D - 1) * ($i - 0.5) / $N" | bc -l); ffmpeg -v error -y -ss $t -i "$IN" -frames:v 1 -q:v 2 "$OUT/stills/still_$(printf %02d $i).jpg"; done
ls "$OUT/clips" | wc -l
