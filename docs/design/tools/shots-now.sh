#!/bin/bash
# Screenshots the running demo website. usage: shots-now.sh OUT_DIR PREFIX
T=$(cd "$(dirname "$0")" && pwd); TOOLS=${SHOTS_TOOLS:-/tmp/lh}
cp $T/shots.mjs $TOOLS/_shots.mjs && (cd $TOOLS && node _shots.mjs http://localhost:3380 "$1" "$2") && python3 $T/stitch.py "$1"
