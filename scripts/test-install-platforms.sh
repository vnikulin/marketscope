#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# The source path is resolved from the script location at runtime.
# shellcheck disable=SC1091
source "$repository_root/install.sh"

for version in 22.04 24.04 26.04; do
  supported_ubuntu_version "$version" || {
    printf 'Expected Ubuntu %s to be supported.\n' "$version" >&2
    exit 1
  }
done

for version in 20.04 25.10 26.10 unknown ''; do
  if supported_ubuntu_version "$version"; then
    printf 'Expected Ubuntu %s to be rejected.\n' "${version:-<empty>}" >&2
    exit 1
  fi
done

printf 'Installer platform checks passed.\n'
