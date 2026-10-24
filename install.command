#!/bin/zsh
set -euo pipefail
TASK_ROOT="${0:A:h}"
PYTHON="$(command -v python3)"
TASK_RUNTIME="$HOME/Library/Application Support/YandexVideoDownloader"
mkdir -p "$TASK_RUNTIME/native"
"$PYTHON" -m venv "$TASK_RUNTIME/native/venv"
"$TASK_RUNTIME/native/venv/bin/python" -m pip install --disable-pip-version-check --index-url https://pypi.org/simple 'yt-dlp[default]'
"$TASK_RUNTIME/native/venv/bin/python" "$TASK_ROOT/native/register.py"
print 'Готово. Теперь загрузите корень этого репозитория через chrome://extensions → Режим разработчика → Загрузить распакованное расширение.'
