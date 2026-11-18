#!/usr/bin/env bash
set -euo pipefail

version=$(node -p "require('./package.json').version")
tag="v$version"
build=true
publish=false

if [[ "$REF_TYPE" == "tag" ]]; then
  if [[ "$REF_NAME" != "$tag" ]]; then
    echo "Tag $REF_NAME does not match package.json version $version" >&2
    exit 1
  fi
  if ! git merge-base --is-ancestor HEAD origin/main; then
    echo 'The tagged commit is not in main history' >&2
    exit 1
  fi
  if [[ "$EVENT_NAME" == "push" ]]; then publish=true; fi
elif [[ "$EVENT_NAME" == "push" ]]; then
  previous_version=$(git show "$EVENT_BEFORE:package.json" | jq -r .version)
  if [[ "$previous_version" == "$version" ]]; then
    echo 'package.json changed without a version change; skipping release build'
    build=false
  else
    if git rev-parse --verify --quiet "refs/tags/$tag"; then
      echo "Release tag already exists: $tag" >&2
      exit 1
    fi
    publish=true
  fi
fi

if [[ "$build" == true && "$(jq -r '.version, .packages[""].version' package-lock.json | sort -u)" != "$version" ]]; then
  echo 'package.json and package-lock.json versions do not match' >&2
  exit 1
fi
echo "build=$build" >> "$GITHUB_OUTPUT"
echo "publish=$publish" >> "$GITHUB_OUTPUT"
echo "tag=$tag" >> "$GITHUB_OUTPUT"
echo "version=$version" >> "$GITHUB_OUTPUT"
