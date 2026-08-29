#!/usr/bin/env bash
# Rebuilds frontend/public/sounds/ from the source clips in $U.
# Point $U at a folder holding your own wav/mp3 files and re-run from the
# project root:  bash deploy/regenerate-sounds.sh
# Requires ffmpeg. Each clip is silence-trimmed, faded, and levelled so no
# single event is louder than the others.
set -e
U=/mnt/user-data/uploads
OUT=frontend/public/sounds
# Trim silence at both ends, level every clip to the same loudness (so one file
# isn't twice as loud as the next), mono 64k mp3.
conv() {
  tmp=$(mktemp /tmp/XXXX.wav)
  # 1) trim leading silence hard, trailing silence gently (a reverb tail cut at
  #    -45dB clicks); 2) level every clip to the same loudness.
  ffmpeg -v error -y -i "$1" -vn -map_metadata -1 \
    -af "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.08,areverse,loudnorm=I=-18:TP=-2" \
    -ac 1 -ar 44100 "$tmp"
  # 3) 40ms fade at the very end so the cut is never audible as a click.
  dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$tmp")
  st=$(python3 -c "print(max(0,$dur-0.04))")
  ffmpeg -v error -y -i "$tmp" -af "afade=t=out:st=$st:d=0.04" -ac 1 -ar 44100 -b:a 64k "$OUT/$2.mp3"
  rm -f "$tmp"
}
ORDER="$U/saat_ada_order_masuk.wav"
MSG="$U/saat_ada_pesan_masuk.mp3"
CLOSE="$U/saat_dibatalkan_atau_di_cancel_atau_selesai.wav"
PAID="$U/mixkit-game-success-alert-2039.wav"
DONE="$U/mixkit-achievement-completed-2068.wav"
ALERT="$U/mixkit-musical-alert-notification-2309.wav"

conv "$ORDER" newOrder
conv "$MSG"   message
conv "$PAID"  paid
conv "$DONE"  done
conv "$ALERT" duplicate
conv "$ALERT" error
for e in cancelled invalid refused timeout; do conv "$CLOSE" $e; done
# Frequent low-value states share the close sound; they ship switched OFF.
for e in unpaid waiting processing; do conv "$ALERT" $e; done
