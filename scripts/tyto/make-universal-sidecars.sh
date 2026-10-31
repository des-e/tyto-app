#!/usr/bin/env bash
# Glue the aarch64 and x86_64 macOS sidecars into universal binaries.
#
# Usage: make-universal-sidecars.sh <bin_dir>
#
# `chore setup aarch64-apple-darwin` and `chore setup x86_64-apple-darwin` put
# `<name>-aarch64-apple-darwin` and `<name>-x86_64-apple-darwin` into <bin_dir>.
# Tauri building `--target universal-apple-darwin` looks for
# `<name>-universal-apple-darwin`, so every Mach-O pair with the same name is
# merged with `lipo -create`. tyto-engine and ffmpeg are required; any other
# pair (e.g. a dylib shipped next to them) is merged too. macOS runners only.
set -eu

if [ "$#" -ne 1 ]; then
    echo "usage: $0 <bin_dir>" >&2
    exit 2
fi

bin_dir=$1
arm=aarch64-apple-darwin
x86=x86_64-apple-darwin
uni=universal-apple-darwin

if [ ! -d "$bin_dir" ]; then
    echo "error: $bin_dir is not a directory" >&2
    exit 1
fi

for required in tyto-engine ffmpeg; do
    for triple in "$arm" "$x86"; do
        if [ ! -f "$bin_dir/$required-$triple" ]; then
            echo "error: $bin_dir/$required-$triple is missing (run chore setup $triple)" >&2
            exit 1
        fi
    done
done

made=""
for arm_file in "$bin_dir"/*"$arm"*; do
    [ -f "$arm_file" ] || continue
    base=$(basename "$arm_file")
    x86_file="$bin_dir/$(printf '%s' "$base" | sed "s/$arm/$x86/")"
    out_file="$bin_dir/$(printf '%s' "$base" | sed "s/$arm/$uni/")"
    if [ ! -f "$x86_file" ]; then
        echo "error: $arm_file has no x86_64 counterpart $x86_file" >&2
        exit 1
    fi
    # Only Mach-O files can be merged; lipo -info fails on anything else.
    if ! lipo -info "$arm_file" >/dev/null 2>&1; then
        echo "skip: $base is not a Mach-O file"
        continue
    fi
    echo "lipo -create $base + $(basename "$x86_file") -> $(basename "$out_file")"
    lipo -create "$arm_file" "$x86_file" -output "$out_file"
    chmod 755 "$out_file"
    made="$made $out_file"
done

if [ -z "$made" ]; then
    echo "error: nothing was merged in $bin_dir" >&2
    exit 1
fi

status=0
for f in $made; do
    info=$(lipo -info "$f")
    echo "$info"
    case "$info" in
        *x86_64*) ;;
        *) echo "error: $f lacks x86_64" >&2; status=1 ;;
    esac
    case "$info" in
        *arm64*) ;;
        *) echo "error: $f lacks arm64" >&2; status=1 ;;
    esac
done
exit "$status"
