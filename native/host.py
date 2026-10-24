#!/usr/bin/env python3
"""Private Chrome native host. No shell, cookies, credentials or listening socket."""
import json, os, re, signal, struct, subprocess, sys, threading, time
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
HOST = 'ru.local.yandex_video_downloader'
ROOT = Path(__file__).resolve().parent.parent
EXT_ID = (ROOT/'extension-id.txt').read_text().strip()

def valid_url(value):
    if not isinstance(value,str) or len(value)>2048 or any(ord(c)<33 for c in value): return False
    try:
        u=urlsplit(value)
        if u.scheme!='https' or u.username or u.password or u.port: return False
        h,p=u.hostname,u.path
        if h=='dzen.ru': return bool(re.fullmatch(r'/video/watch/[a-fA-F0-9]+/?',p))
        if h=='rutube.ru': return bool(re.fullmatch(r'/video/[a-fA-F0-9]{32}/?',p))
        if h=='ok.ru': return bool(re.fullmatch(r'/video/[0-9]+/?',p))
        if h in ('vk.com','vkvideo.ru'): return bool(re.fullmatch(r'/video-?[0-9]+_[0-9]+/?',p))
        if h=='youtu.be': return bool(re.fullmatch(r'/[\w-]{11}/?',p,flags=re.ASCII))
        if h in ('youtube.com','www.youtube.com','m.youtube.com'):
            return bool(re.fullmatch(r'[\w-]{11}',parse_qs(u.query).get('v',[''])[0],flags=re.ASCII)) if p=='/watch' else bool(re.fullmatch(r'/(shorts|embed)/[\w-]{11}/?',p,flags=re.ASCII))
    except (ValueError,TypeError): pass
    return False

def read_exact(stream,n):
    data=bytearray()
    while len(data)<n:
        part=stream.read(n-len(data))
        if not part: raise EOFError
        data.extend(part)
    return bytes(data)

def read_message(stream):
    size=struct.unpack('@I',read_exact(stream,4))[0]
    if not 0<size<=8192: raise ValueError('message size')
    msg=json.loads(read_exact(stream,size))
    if not isinstance(msg,dict): raise ValueError('message type')
    return msg

write_lock=threading.Lock()
def send(msg):
    data=json.dumps(msg,ensure_ascii=False).encode()
    with write_lock:
        sys.stdout.buffer.write(struct.pack('@I',len(data))+data);sys.stdout.buffer.flush()

def worker(url):
    # Separate process permits real cancellation, including extractor/ffmpeg children.
    def emit(**msg): print(json.dumps(msg,ensure_ascii=False),flush=True)
    try:
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
        opts={'quiet':True,'no_warnings':True,'logger':Quiet(),'noplaylist':True,'playlistend':1,
              'socket_timeout':25,'retries':2,'fragment_retries':2,'continuedl':True,
              'outtmpl':str(target/'%(title).140B [%(id)s].%(ext)s'),'restrictfilenames':False,
              'windowsfilenames':True,'overwrites':False,'progress_hooks':[progress],
              'format':'bv*[height<=1080]+ba/b[height<=1080]/b' if ffmpeg else 'b[height<=1080]/b',
              'merge_output_format':'mp4','max_filesize':4*1024**3,'match_filter':lambda info,**kw: 'Прямые эфиры не поддерживаются' if info.get('is_live') else None}
        if ffmpeg: opts['ffmpeg_location']=str(Path(ffmpeg).parent)
        emit(status='progress',text='Получение полного видео…')
        with yt_dlp.YoutubeDL(opts) as ydl:
            info=ydl.extract_info(url,download=True)
            if not info or info.get('_type') in ('playlist','multi_video'): raise ValueError('no single video')
            # Completion requires an actual complete media file, not only a finished fragment.
            expected=Path(ydl.prepare_filename(info))
            candidates=[Path(info['filepath'])] if info.get('filepath') else []
            candidates += [expected,expected.with_suffix('.mp4'),expected.with_suffix('.mkv'),expected.with_suffix('.webm')]
            file=next((p for p in candidates if p.is_file() and p.stat().st_size>0 and p.resolve().parent==target.resolve()),None)
            if not file: raise ValueError('no output')
            emit(status='done',text='Сохранено в Загрузки/Яндекс Видео',filename=file.name)
        return 0
    except Exception:
        emit(status='error',text='Не удалось скачать ролик. Источник может требовать вход, ограничивать доступ или пока не поддерживаться.');return 1

def main():
    if len(sys.argv)>1 and sys.argv[1]=='--worker':
        return worker(sys.argv[2]) if len(sys.argv)==3 and valid_url(sys.argv[2]) else 2
    if len(sys.argv)!=2 or sys.argv[1]!=f'chrome-extension://{EXT_ID}/': return 2
    input_stream=os.fdopen(os.dup(sys.stdin.fileno()), 'rb', buffering=0)
    try: msg=read_message(input_stream)
    except (EOFError,ValueError,json.JSONDecodeError): return 2
    if msg.get('action')=='ping':
        send({'status':'ready','version':'1.2.0'});return 0
    if msg.get('action')=='open-folder':
        try:
            target=Path.home()/'Downloads'/'Яндекс Видео'
            target.mkdir(parents=True,exist_ok=True)
            result=subprocess.run(['/usr/bin/open',str(target)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
            send({'status':'done' if result.returncode==0 else 'error'});return 0
        except (OSError,subprocess.TimeoutExpired):
            send({'status':'error'});return 1
    if msg.get('action')!='download' or not valid_url(msg.get('url')):
        send({'status':'error','text':'Недопустимая ссылка на видео.'});return 2
    process=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--worker',msg['url']],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,start_new_session=True)
    cancelled=threading.Event();finished=threading.Event()
    def stop():
        if process.poll() is None:
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
