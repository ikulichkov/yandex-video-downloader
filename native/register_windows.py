"""Per-user Windows registration for Chrome and Yandex Browser; no admin rights."""
import json, os, sys
from pathlib import Path

def install():
    if sys.platform!='win32': raise SystemExit('This installer requires Windows.')
    import winreg
    source=Path(__file__).resolve().parent.parent
    runtime=Path(os.environ['LOCALAPPDATA'])/'YandexVideoDownloader'
    python=runtime/'native'/'venv'/'Scripts'/'python.exe'
    if not python.is_file(): raise SystemExit('Run install-windows.cmd first.')
    launcher=runtime/'native'/'launch.cmd'
    manifest_path=runtime/'native-host.json'
    origin='chrome-extension://'+(source/'extension-id.txt').read_text().strip()+'/'
    manifest={'name':'ru.local.yandex_video_downloader','description':'Video downloader local helper','path':str(launcher),'type':'stdio','allowed_origins':[origin]}
    keys=[rf'Software\{browser}\NativeMessagingHosts\ru.local.yandex_video_downloader' for browser in [r'Google\Chrome',r'Yandex\YandexBrowser']]
    for key in keys:
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,key) as handle: old=winreg.QueryValueEx(handle,'')[0]
            if Path(old)!=manifest_path: raise SystemExit('Another host registration exists; refusing overwrite.')
        except FileNotFoundError: pass
    for path in [runtime,runtime/'native',launcher,manifest_path,runtime/'native'/'host.py',runtime/'native'/'music.py',runtime/'extension-id.txt']:
        if path.is_symlink(): raise SystemExit('Symlink install target rejected.')
    def write(path,content):
        temporary=path.with_name(path.name+'.install-tmp')
        with temporary.open('x',encoding='utf-8',newline='') as stream: stream.write(content)
        temporary.replace(path)
    write(runtime/'native'/'host.py',(source/'native'/'host.py').read_text(encoding='utf-8'))
    write(runtime/'native'/'music.py',(source/'native'/'music.py').read_text(encoding='utf-8'))
    write(runtime/'extension-id.txt',(source/'extension-id.txt').read_text())
    write(launcher,'@echo off\r\nchcp 65001 >nul\r\n"'+str(python)+'" "'+str(runtime/'native'/'host.py')+'" %*\r\n')
    write(manifest_path,json.dumps(manifest,ensure_ascii=False,indent=2))
    for key in keys:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER,key) as handle: winreg.SetValueEx(handle,'',0,winreg.REG_SZ,str(manifest_path))
    print('Windows helper registered for Chrome and Yandex Browser.')
if __name__=='__main__':install()
