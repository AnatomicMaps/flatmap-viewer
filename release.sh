#!/bin/sh

git status | grep -q "nothing to commit"
dirty=($? != 0)
if (( dirty )); then
    git stash -u
fi

git push origin
git push origin v$1
gh release create v$1 --verify-tag --title "Release $1" --notes ""

gh workflow run publish.yaml --ref v$1

if (( dirty )); then
    git stash pop --quiet
fi
