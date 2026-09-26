#!/usr/bin/env bash
# Tvättar ljudklipp enligt docs/SPEC.md → Ljudklipp – riktlinjer:
#   - tar bort tystnad i början och slutet (med kort fade så att det inte klickar)
#   - normaliserar ljudnivån (ca −14 LUFS, max −1,5 dBTP, två pass med loudnorm)
#   - konverterar till MP3, mono, 44,1 kHz, 128 kbps, utan metadata
#   - döper om till gemener utan mellanslag eller å/ä/ö
#
# Användning:
#   scripts/tvatta-klipp.sh                  # alla filer i clips/original/
#   scripts/tvatta-klipp.sh fil1.wav fil2.m4a
#
# Originalen lämnas orörda; resultatet hamnar i clips/<namn>.mp3.
# Inställningar via miljövariabler:
#   TROSKEL=-50dB   nivå som räknas som tystnad
#   MAX_SEK=5       korta klippet till max så här många sekunder (med fade-out); tomt = ingen gräns
#   LUFS=-14        målnivå
set -euo pipefail
cd "$(dirname "$0")/.."

FFMPEG=${FFMPEG:-ffmpeg}
TROSKEL=${TROSKEL:--50dB}
MAX_SEK=${MAX_SEK:-}
LUFS=${LUFS:--14}
TP=-1.5
LRA=11
UT=clips

command -v "$FFMPEG" >/dev/null || { echo "Hittar inte ffmpeg (installera eller sätt FFMPEG=/sökväg/till/ffmpeg)" >&2; exit 1; }

if [ $# -eq 0 ]; then
  shopt -s nullglob
  set -- clips/original/*
  [ $# -gt 0 ] || { echo "Inga filer i clips/original/ – lägg originalen där eller ange filer som argument." >&2; exit 1; }
fi

slug() {
  local n
  n=$(basename "$1")
  n=${n%.*}
  # Å/Ä/Ö ersätts en i taget (tr och [..] i sed hanterar inte flerbytestecken överallt).
  printf '%s' "$n" \
    | sed -e 's/Å/a/g' -e 's/å/a/g' -e 's/Ä/a/g' -e 's/ä/a/g' -e 's/Ö/o/g' -e 's/ö/o/g' -e 's/É/e/g' -e 's/é/e/g' \
    | tr 'A-Z' 'a-z' \
    | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-//' -e 's/-$//'
}

langd() {
  "$FFMPEG" -hide_banner -i "$1" -f null - 2>&1 | grep -o 'time=[0-9:.]*' | tail -1 | cut -d= -f2
}

# Tystnad bort i början, vänd, tystnad bort i (det som var) slutet + fade-out, vänd tillbaka, fade-in.
trim="silenceremove=start_periods=1:start_threshold=${TROSKEL}:start_silence=0.01"
trim+=",areverse,silenceremove=start_periods=1:start_threshold=${TROSKEL}:start_silence=0.05"
trim+=",afade=t=in:d=0.03,areverse,afade=t=in:d=0.005"
if [ -n "$MAX_SEK" ]; then
  fade_start=$(awk "BEGIN{print ($MAX_SEK > 0.3) ? $MAX_SEK - 0.3 : 0}")
  trim+=",atrim=0:${MAX_SEK},afade=t=out:st=${fade_start}:d=0.3"
fi

mkdir -p "$UT"
for in in "$@"; do
  [ -f "$in" ] || { echo "Hittar inte $in" >&2; continue; }
  namn=$(slug "$in")
  ut="$UT/$namn.mp3"
  if [ "$(cd "$(dirname "$in")" && pwd)/$(basename "$in")" = "$PWD/$ut" ]; then
    echo "Hoppar över $in: källa och resultat är samma fil (lägg originalet i clips/original/)" >&2
    continue
  fi

  # Pass 1: mät ljudnivån efter trimning.
  matning=$("$FFMPEG" -hide_banner -nostats -i "$in" -ac 1 \
    -af "$trim,loudnorm=I=$LUFS:TP=$TP:LRA=$LRA:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
  varde() { printf '%s' "$matning" | grep "\"$1\"" | sed 's/.*: *"\([^"]*\)".*/\1/'; }
  if [ -z "$(varde input_i)" ] || [ "$(varde input_i)" = "-inf" ]; then
    echo "Hoppar över $in: bara tystnad kvar efter trimning (prova TROSKEL=-60dB)" >&2
    continue
  fi

  # Pass 2: linjär normalisering med uppmätta värden, konvertera.
  "$FFMPEG" -hide_banner -loglevel error -y -i "$in" -map_metadata -1 -ac 1 \
    -af "$trim,loudnorm=I=$LUFS:TP=$TP:LRA=$LRA:measured_I=$(varde input_i):measured_TP=$(varde input_tp):measured_LRA=$(varde input_lra):measured_thresh=$(varde input_thresh):offset=$(varde target_offset):linear=true" \
    -ar 44100 -c:a libmp3lame -b:a 128k "$ut"

  printf '%-28s %9s → %-24s %9s  %4d kB\n' "$(basename "$in")" "$(langd "$in")" "$ut" "$(langd "$ut")" $(( $(wc -c < "$ut") / 1024 ))
done
