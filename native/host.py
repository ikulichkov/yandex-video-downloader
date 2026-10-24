#!/usr/bin/env python3
"""Private Chrome native host. No shell, cookies, credentials or listening socket."""
import json, os, re, signal, struct, subprocess, sys, threading, time, socket, ipaddress
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
HOST = 'ru.local.yandex_video_downloader'
ROOT = Path(__file__).resolve().parent.parent
EXT_ID = (ROOT/'extension-id.txt').read_text().strip()

def is_public_address(value):
    address=ipaddress.ip_address(value)
    return address.is_global and not address.is_multicast and not address.is_reserved

def valid_url(value):
    if not isinstance(value,str) or len(value)>8192 or any(ord(c)<33 for c in value) or '\\' in value:return False
    try:
        u=urlsplit(value);host=(u.hostname or '').lower().rstrip('.')
        if u.scheme not in ('http','https') or u.username or u.password or not host or '%' in host:return False
        if u.port is not None and not 1<=u.port<=65535:return False
        if host=='localhost' or host.endswith(('.local','.localhost','.internal','.invalid')):return False
        try:return is_public_address(host)
        except ValueError:return '.' in host
    except (ValueError,TypeError):return False

def install_public_network_guard():
    """Validate the addresses actually used for each Python connection, also on redirects."""
    original=socket.getaddrinfo
    def public_getaddrinfo(host,port,*args,**kwargs):
        answers=original(host,port,*args,**kwargs)
        if not answers or any(not is_public_address(item[4][0].split('%')[0]) for item in answers):
            raise OSError('Private/local network targets are disabled')
        return answers
    socket.getaddrinfo=public_getaddrinfo
    return original

def error_message(exc):
    text=str(exc).lower()
    if re.search(r'sign in|log ?in|not a bot|authentication|authorization required',text):return 'Источник требует вход или подтверждения. Автоматическое скачивание недоступно.'
    if re.search(r'private/local network|local network targets',text):return 'Локальные и внутренние сетевые адреса не скачиваются.'
    if re.search(r'403|forbidden|access denied',text):return 'Источник запретил скачивание этого ролика.'
    if re.search(r'429|too many requests',text):return 'Источник временно ограничил запросы. Повторите позже.'
    if 'multiple videos' in text:return 'На странице несколько роликов. Нажмите кнопку у нужной карточки.'
    if re.search(r'unsupported url|no video formats|no formats found',text):return 'Не найден доступный видеофайл. Источник может скрывать или защищать поток.'
    if re.search(r'timeout|timed out|network is unreachable',text):return 'Нет связи с источником. Попробуйте позже.'
    return 'Не удалось скачать ролик. Он может быть закрыт, защищён или пока не распознаваться загрузчиком.'

def read_exact(stream,n):
    data=bytearray()
    while len(data)<n:
        part=stream.read(n-len(data))
        if not part: raise EOFError
        data.extend(part)
    return bytes(data)

def read_message(stream):
    size=struct.unpack('@I',read_exact(stream,4))[0]
    if not 0<size<=16384: raise ValueError('message size')
    msg=json.loads(read_exact(stream,size))
    if not isinstance(msg,dict): raise ValueError('message type')
    return msg

write_lock=threading.Lock()
def send(msg):
    data=json.dumps(msg,ensure_ascii=False).encode()
    with write_lock:
        sys.stdout.buffer.write(struct.pack('@I',len(data))+data);sys.stdout.buffer.flush()

def format_selector(quality, ffmpeg):
    if quality not in ('best','1080','720','480','360'): raise ValueError('invalid quality')
    protocol="[protocol~='^(https?|m3u8(_native)?|http_dash_segments)$']"
    height='' if quality=='best' else f'[height<={quality}]'
    return f'bv*{height}{protocol}+ba{protocol}/b{height}{protocol}' if ffmpeg else f'b{height}{protocol}'

def worker(url, quality='best'):
    # Separate process permits real cancellation, including extractor/ffmpeg children.
    def emit(**msg): print(json.dumps(msg,ensure_ascii=False),flush=True)
    try:
        install_public_network_guard()
        import yt_dlp
        from shutil import which
        target=Path.home()/'Downloads'/'Яндекс Видео';target.mkdir(parents=True,exist_ok=True)
        last=[0.0]
        def progress(d):
            now=time.monotonic()
            if d.get('status')=='downloading' and now-last[0]>.6:
                last[0]=now
                total=d.get('total_bytes') or d.get('total_bytes_estimate') or 0
                pct=min(100,round(100*d.get('downloaded_bytes',0)/total)) if total else None
                emit(status='progress',percent=pct,text=f'Скачивание {pct}%' if pct is not None else 'Скачивание…')
            elif d.get('status')=='finished': emit(status='processing',text='Подготовка файла…')
        class Quiet:
            def debug(self,*a): pass
            def warning(self,*a): pass
            def error(self,*a): pass
        ffmpeg=next((p for p in [which('ffmpeg'),'/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg'] if p and Path(p).is_file()),None)
        if not ffmpeg:
            try:
                import imageio_ffmpeg
                ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
            except (ImportError,RuntimeError): pass
        opts={'quiet':True,'no_warnings':True,'logger':Quiet(),'noplaylist':True,'playlistend':1,
              'socket_timeout':25,'retries':2,'fragment_retries':2,'continuedl':True,
              'outtmpl':str(target/'%(title).140B [%(id)s] [%(height)sp].%(ext)s'),'restrictfilenames':False,
              'windowsfilenames':True,'overwrites':False,'progress_hooks':[progress],
              'format':format_selector(quality,ffmpeg),
              'enable_file_urls':False,'hls_prefer_native':True,'external_downloader':{'default':'native'},
              'merge_output_format':'mp4','match_filter':lambda info,**kw: 'Прямые эфиры не поддерживаются' if info.get('is_live') else None}
        if ffmpeg: opts['ffmpeg_location']=str(ffmpeg)
        node=next((p for p in [which('node'),'/opt/homebrew/bin/node','/usr/local/bin/node'] if p and Path(p).is_file()),None)
        if node:opts['js_runtimes']={'node':{'path':node}}
        emit(status='progress',text='Получение полного видео…')
        with yt_dlp.YoutubeDL(opts) as ydl:
            info=ydl.extract_info(url,download=False)
            if not info or info.get('_type') in ('playlist','multi_video'): raise ValueError('multiple videos: choose a video card')
            info=ydl.process_ie_result(info,download=True)
            # Completion requires an actual complete media file, not only a finished fragment.
            expected=Path(ydl.prepare_filename(info))
            candidates=[Path(info['filepath'])] if info.get('filepath') else []
            candidates += [expected,expected.with_suffix('.mp4'),expected.with_suffix('.mkv'),expected.with_suffix('.webm')]
            file=next((p for p in candidates if p.is_file() and p.stat().st_size>0 and p.resolve().parent==target.resolve()),None)
            if not file: raise ValueError('no output')
            emit(status='done',text='Сохранено в Загрузки/Яндекс Видео',filename=file.name)
        return 0
    except Exception as exc:
        emit(status='error',text=error_message(exc));return 1

def main():
    if len(sys.argv)>1 and sys.argv[1]=='--worker':
        return worker(sys.argv[2],sys.argv[3] if len(sys.argv)==4 else 'best') if len(sys.argv) in (3,4) and valid_url(sys.argv[2]) and (len(sys.argv)==3 or sys.argv[3] in ('best','1080','720','480','360')) else 2
    if len(sys.argv)<2 or sys.argv[1]!=f'chrome-extension://{EXT_ID}/' or any(not x.startswith('--parent-window=') for x in sys.argv[2:]): return 2
    if sys.platform=='win32':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY);msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
    input_stream=os.fdopen(os.dup(sys.stdin.fileno()), 'rb', buffering=0)
    try: msg=read_message(input_stream)
    except (EOFError,ValueError,json.JSONDecodeError): return 2
    if msg.get('action')=='ping':
        send({'status':'ready','version':'2.2.0'});return 0
    if msg.get('action')=='open-folder':
        try:
            target=Path.home()/'Downloads'/'Яндекс Видео'
            target.mkdir(parents=True,exist_ok=True)
            if sys.platform=='win32': os.startfile(str(target));result_code=0
            else: result_code=subprocess.run(['/usr/bin/open',str(target)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10).returncode
            send({'status':'done' if result_code==0 else 'error'});return 0
        except (OSError,subprocess.TimeoutExpired):
            send({'status':'error'});return 1
    if msg.get('action')=='trash-file':
        try:
            target=(Path.home()/'Downloads'/'Яндекс Видео').resolve()
            file=Path(msg.get('filename',''))
            if file.is_symlink() or not file.is_file() or file.parent.resolve()!=target: raise ValueError('path')
            from send2trash import send2trash
            send2trash(str(file));send({'status':'done'});return 0
        except Exception:
            send({'status':'error','text':'Не удалось переместить файл в корзину. Файл сохранён.'});return 1
    if msg.get('action')!='download' or not valid_url(msg.get('url')):
        send({'status':'error','text':'Недопустимая ссылка на видео.'});return 2
    quality=msg.get('quality','best')
    if quality not in ('best','1080','720','480','360'):
        send({'status':'error','text':'Недопустимое качество видео.'});return 2
    process=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--worker',msg['url'],quality],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',env={**os.environ,'PYTHONIOENCODING':'utf-8'},start_new_session=sys.platform!='win32',creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
    cancelled=threading.Event();finished=threading.Event()
    def stop():
        if process.poll() is None:
            if sys.platform=='win32':
                subprocess.run([str(Path(os.environ['SystemRoot'])/'System32'/'taskkill.exe'),'/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10,creationflags=subprocess.CREATE_NO_WINDOW)
                return
            try: os.killpg(process.pid,signal.SIGTERM)
            except ProcessLookupError: pass
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try: os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError: pass
    def control():
        try:
            while not finished.is_set():
                cmd=read_message(input_stream)
                if cmd.get('action')=='cancel': cancelled.set();stop();return
        except (EOFError,ValueError,json.JSONDecodeError):
            if not finished.is_set():cancelled.set();stop()
    threading.Thread(target=control,daemon=True).start()
    terminal=False
    try:
        for line in process.stdout:
            try: event=json.loads(line)
            except ValueError: continue
            if cancelled.is_set(): continue
            if event.get('status') in ('done','error'): terminal=True
            send(event)
        process.wait()
        finished.set()
        if cancelled.is_set():send({'status':'cancelled','text':'Отменено. Неполный файл можно удалить из папки загрузок.'})
        elif not terminal:send({'status':'error','text':'Скачивание прервано. Нажмите «Скачать», чтобы повторить.'})
    except (BrokenPipeError,OSError):stop()
    finally:finished.set();stop()
    return 0
if __name__=='__main__':sys.exit(main())
