#!/usr/bin/env bash
# One download per system: the overlay folder with that system's relay executable already inside.
#
#   bash tools/bundle-release.sh <git ref> <folder name> <directory holding kick-relay-*>
#
# For each kick-relay-<system>[.exe] in the directory it writes <folder name>-<system>.zip next to it, holding the
# tracked files at <git ref> (as `git archive` exports them) plus that executable. The release workflow runs it at
# the tag; CI runs it on every change with the executable it has just built, so the release is not its first run.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: bash tools/bundle-release.sh <git ref> <folder name> <directory holding kick-relay-*>" >&2
  exit 2
fi
ref="$1"
base="$2"
out="$(cd "$3" && pwd)"

count=0
for exe in "$out"/kick-relay-*; do
  [ -f "$exe" ] || continue
  name="$(basename "$exe")"
  system="${name#kick-relay-}"
  system="${system%.exe}"
  zipfile="${out}/${base}-${system}.zip"
  work="$(mktemp -d)"

  git archive --format=tar --prefix="${base}/" "$ref" | tar -x -C "$work"
  cp "$exe" "${work}/${base}/${name}"
  # Artifacts lose their mode bits on the way between jobs; without this the relay would not start on Linux or macOS.
  chmod +x "${work}/${base}/${name}"
  rm -f "$zipfile"
  (cd "$work" && zip -q -r -X "$zipfile" "$base")

  # Read the zip back the way a streamer would: unpack it and look for what the first run needs.
  check="$(mktemp -d)"
  unzip -q "$zipfile" -d "$check"
  for need in "$name" studio.html AYARLAR.js shared/kick-core.js relay/server.js; do
    if [ ! -f "${check}/${base}/${need}" ]; then
      echo "bundle-release: ${base}-${system}.zip has no ${need}" >&2
      exit 1
    fi
  done
  case "$name" in
    *.exe) ;;
    *)
      if [ ! -x "${check}/${base}/${name}" ]; then
        echo "bundle-release: ${name} is not executable inside ${base}-${system}.zip" >&2
        exit 1
      fi
      ;;
  esac
  if ! cmp -s "$exe" "${check}/${base}/${name}"; then
    echo "bundle-release: ${name} inside ${base}-${system}.zip differs from the built executable" >&2
    exit 1
  fi
  rm -rf "$work" "$check"

  echo "${base}-${system}.zip"
  count=$((count + 1))
done

if [ "$count" -eq 0 ]; then
  echo "bundle-release: no kick-relay-* executable in ${out}" >&2
  exit 1
fi
