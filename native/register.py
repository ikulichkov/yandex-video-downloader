"""Register this local macOS helper without replacing another host registration."""
import json
import os
import shlex
import sys
from pathlib import Path

source = Path(__file__).resolve().parent.parent
runtime = Path.home() / 'Library' / 'Application Support' / 'YandexVideoDownloader'
python = runtime / 'native' / 'venv' / 'bin' / 'python'
launcher = runtime / 'native' / 'launch.command'
folder = Path.home() / 'Library' / 'Application Support' / 'Google' / 'Chrome' / 'NativeMessagingHosts'
path = folder / 'ru.local.yandex_video_downloader.json'
origin = 'chrome-extension://' + (source / 'extension-id.txt').read_text().strip() + '/'
manifest = {'name': 'ru.local.yandex_video_downloader', 'description': 'Yandex Video local downloader',
            'path': str(launcher), 'type': 'stdio', 'allowed_origins': [origin]}
if sys.platform != 'darwin':
    raise SystemExit('Этот установщик предназначен для macOS.')
if not python.is_file() or not os.access(python, os.X_OK):
    raise SystemExit('Сначала выполните install.command')
for target in [runtime, runtime/'native', runtime/'native'/'host.py', runtime/'extension-id.txt', launcher, path]:
    if target.is_symlink():
        raise SystemExit('Обнаружена символьная ссылка в месте установки; запись остановлена.')
if path.exists() and json.loads(path.read_text()) != manifest:
    old = json.loads(path.read_text())
    if old.get('path') != str(source/'native'/'launch.command') or old.get('allowed_origins') != [origin]:
        raise SystemExit('Другая регистрация уже существует; не перезаписываю.')
    backup = path.with_suffix('.pre-migration.json')
    if not backup.exists():
        backup.write_text(path.read_text()); backup.chmod(0o600)
(runtime/'native').mkdir(parents=True, exist_ok=True)
folder.mkdir(parents=True, exist_ok=True)
def write_atomic(target, text, mode):
    temporary = target.with_name(target.name + '.install-tmp')
    with temporary.open('x') as stream:
        stream.write(text)
    temporary.chmod(mode)
    temporary.replace(target)
write_atomic(runtime/'native'/'host.py', (source/'native'/'host.py').read_text(), 0o600)
write_atomic(runtime/'extension-id.txt', (source/'extension-id.txt').read_text(), 0o600)
write_atomic(launcher, '#!/bin/zsh\nexec ' + shlex.quote(str(python)) + ' ' + shlex.quote(str(runtime/'native'/'host.py')) + ' "$@"\n', 0o700)
write_atomic(path, json.dumps(manifest, indent=2), 0o600)
print('Локальный помощник зарегистрирован для одного расширения.')
