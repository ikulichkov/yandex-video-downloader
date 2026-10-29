import importlib.util, io, json, struct, subprocess, sys, tempfile
from pathlib import Path
from unittest.mock import patch
root=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root/'native'))
spec=importlib.util.spec_from_file_location('yvd_host',root/'native/host.py');host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
origin='chrome-extension://'+host.EXT_ID+'/'
def frame(msg):
 b=json.dumps(msg).encode();return struct.pack('@I',len(b))+b
for action in ['ping','unknown']:
 p=subprocess.run([sys.executable,str(root/'native/host.py'),origin],input=frame({'action':action}),capture_output=True,timeout=5)
 msg=host.read_message(io.BytesIO(p.stdout));assert msg['status']==('ready' if action=='ping' else 'error')
wrong=subprocess.run([sys.executable,str(root/'native/host.py'),'chrome-extension://wrong/'],input=frame({'action':'ping'}),capture_output=True,timeout=5)
assert wrong.returncode==2 and not wrong.stdout
with tempfile.TemporaryDirectory() as tmp:
 output=io.BytesIO()
 with patch.object(sys,'argv',[str(root/'native/host.py'),origin]),patch.object(host.os,'dup',return_value=0),patch.object(host.os,'fdopen',return_value=io.BytesIO(frame({'action':'open-folder','path':'/etc'}))),patch.object(Path,'home',return_value=Path(tmp)),patch.object(host.subprocess,'run') as run,patch.object(sys,'stdout') as stdout:
  stdout.buffer=output;run.return_value.returncode=0
  assert host.main()==0
  assert run.call_args.args[0]==['/usr/bin/open',str(Path(tmp)/'Downloads'/'Яндекс Видео')]
 assert host.read_message(io.BytesIO(output.getvalue()))['status']=='done'
for bad in ['http://127.0.0.1/video/1','https://localhost/video/1','file:///tmp/x','https://u:p@ok.ru/video/1','https://192.168.1.1/video/1']:assert not host.valid_url(bad)
assert host.valid_url('https://vkvideo.ru/video-234113842_456242445')
print('Native origin, ping, unknown commands, fixed-folder confinement, URL validation PASS')

assert host.valid_url('https://example.com/some/public/page')
assert host.valid_url('http://ok.ru/video/1')
# Validate resolved addresses, not only textual hostnames; redirects use the same guard.
with patch.object(host.socket,'getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
 host.install_public_network_guard()
 try:host.socket.getaddrinfo('example.com',443)
 except OSError:pass
 else:raise AssertionError('private DNS resolution was accepted')
with patch.object(host.socket,'getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))]):
 host.install_public_network_guard();assert host.socket.getaddrinfo('example.com',443)

assert not host.valid_url('http://224.0.0.1/video.mp4')
assert 'требует вход' in host.error_message(ValueError('Sign in to confirm you are not a bot'))
# A generic page containing a playlist must not silently download its first video.
from types import SimpleNamespace
class Playlist:
 processed=False
 def __init__(self,opts):pass
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def extract_info(self,url,download,process=False):
  assert download is False
  return {'_type':'playlist','entries':[{'id':'first'},{'id':'second'}]}
 def process_ie_result(self,*args,**kwargs):
  Playlist.processed=True
  raise AssertionError('playlist download must not start')
with tempfile.TemporaryDirectory() as tmp,patch.object(Path,'home',return_value=Path(tmp)),patch.object(host,'install_public_network_guard'),patch.dict(sys.modules,{'yt_dlp':SimpleNamespace(YoutubeDL=Playlist)}),patch('builtins.print') as emit:
 assert host.worker('https://example.com/video/collection')==1
 assert not Playlist.processed
 assert json.loads(emit.call_args.args[0])['status']=='error'

# Requested caps must never silently fall through to a higher-resolution format.
for quality in ['best','1080','720','480','360']:
 for ffmpeg in [True,False]:
  selector=host.format_selector(quality,ffmpeg)
  assert "protocol~=" in selector
  if quality=='best':assert 'height' not in selector
  else:
   assert all(f'[height<={quality}]' in part for part in selector.split('/'))
try:host.format_selector('1080]+exec',True)
except ValueError:pass
else:raise AssertionError('unvalidated quality')

# Trash accepts only non-symlink files immediately within the fixed download folder.
with tempfile.TemporaryDirectory() as tmp:
 target=Path(tmp)/'Downloads'/'Яндекс Видео';target.mkdir(parents=True);good=target/'video.mp4';good.write_bytes(b'video')
 outside=Path(tmp)/'outside.mp4';outside.write_bytes(b'outside')
 link=target/'link.mp4';link.symlink_to(outside)
 for file,expected in [(good,'done'),(outside,'error'),(link,'error')]:
  output=io.BytesIO();calls=[]
  with patch.object(sys,'argv',[str(root/'native/host.py'),origin]),patch.object(host.os,'dup',return_value=0),patch.object(host.os,'fdopen',return_value=io.BytesIO(frame({'action':'trash-file','filename':str(file)}))),patch.object(Path,'home',return_value=Path(tmp)),patch.dict(sys.modules,{'send2trash':SimpleNamespace(send2trash=lambda f:calls.append(f))}),patch.object(sys,'stdout') as stdout:
   stdout.buffer=output;host.main()
  assert host.read_message(io.BytesIO(output.getvalue()))['status']==expected
  assert bool(calls)==(expected=='done')

# A worker must not inherit the browser's native command pipe (Windows startup hang).
from unittest.mock import MagicMock
output=io.BytesIO();process=MagicMock();process.stdout=[json.dumps({'status':'done','filename':'test.mp4'})];process.poll.return_value=0
with patch.object(sys,'argv',[str(root/'native/host.py'),origin]),patch.object(host.os,'dup',return_value=0),patch.object(host.os,'fdopen',return_value=io.BytesIO(frame({'action':'download','url':'https://example.com/video/1','quality':'720'}))),patch.object(host.subprocess,'Popen',return_value=process) as popen,patch.object(host.threading.Thread,'start'),patch.object(sys,'stdout') as stdout:
 stdout.buffer=output;host.main()
 assert popen.call_args.kwargs['stdin']==subprocess.DEVNULL
 assert popen.call_args.kwargs['encoding']=='utf-8'
 assert popen.call_args.args[0][-1]=='720'

# Completion exposes the actual full path used later by the confined trash action.
class Completed:
 def __init__(self,opts):
  self.file=Path(opts['outtmpl']).parent/'fixture.mp4';self.file.write_bytes(b'fixture')
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def extract_info(self,*args,**kwargs):return {'id':'fixture'}
 def process_ie_result(self,info,download):return {'filepath':str(self.file)}
 def prepare_filename(self,info):return str(self.file)
with tempfile.TemporaryDirectory() as tmp,patch.object(Path,'home',return_value=Path(tmp)),patch.object(host,'install_public_network_guard'),patch.dict(sys.modules,{'yt_dlp':SimpleNamespace(YoutubeDL=Completed)}),patch('builtins.print') as emit:
 assert host.worker('https://example.com/video/1')==0
 result=json.loads(emit.call_args.args[0]);assert result['status']=='done'
 assert Path(result['filename']).is_absolute() and Path(result['filename']).is_file()

# Select one unambiguous card result, never a first playlist item or an entire playlist.
class Metadata:
 def __init__(self,info,children=None):self.info=info;self.children=children or {};self.calls=[]
 def extract_info(self,url,**kwargs):
  assert kwargs['download'] is False and kwargs['process'] is False
  self.calls.append(url);return self.children.get(url,self.info)
a='https://publisher.example/watch?v=2';one={'id':'one','formats':[{'url':'https://cdn.example/one.mp4'}]};two={'id':'two','webpage_url':a,'formats':[{'url':'https://cdn.example/two.mp4'}]}
assert host.resolve_video(Metadata({'_type':'playlist','entries':[one]}),a)==one
assert host.resolve_video(Metadata({'_type':'multi_video','entries':[{'_type':'playlist','entries':[one]}]}),a)==one
assert host.resolve_video(Metadata({'_type':'playlist','entries':[one,two]}),a)==two
entry={'_type':'url','url':'https://cdn.example/one.mp4'}
assert host.resolve_video(Metadata({'_type':'playlist','entries':[entry]},{entry['url']:one}),a)==one
for info in [
 {'_type':'playlist','entries':[one,{'id':'other'}]},
 {'_type':'multi_video','entries':[two,{**two,'id':'another-part'}]},
 {'_type':'playlist','entries':[two]*101},
 {'_type':'playlist','entries':[]},
 {'_type':'url','url':a},
]:
 try:host.resolve_video(Metadata(info),a)
 except ValueError as exc:assert 'multiple videos' in str(exc)
 else:raise AssertionError('ambiguous/unbounded/cyclic source was accepted')
assert 'Нажмите кнопку' not in host.error_message(ValueError('multiple videos'))

# File actions are constrained to saved media; legacy filename-only records are safe.
with tempfile.TemporaryDirectory() as tmp:
 target=Path(tmp)/'Downloads'/'Яндекс Видео';target.mkdir(parents=True);file=target/'video.mp4';file.write_bytes(b'video');exe=target/'run.exe';exe.write_bytes(b'executable');outside=Path(tmp)/'outside.mp4';outside.write_bytes(b'outside')
 with patch.object(Path,'home',return_value=Path(tmp)):
  assert host.downloaded_file('video.mp4',media_only=True)==file.resolve()
  for bad in [str(exe),str(outside),'../outside.mp4','missing.mp4']:
   try:host.downloaded_file(bad,media_only=True)
   except ValueError:pass
   else:raise AssertionError('unsafe file action')
 for action in ['open-file','reveal-file']:
  output=io.BytesIO()
  with patch.object(sys,'argv',[str(root/'native/host.py'),origin]),patch.object(host.os,'dup',return_value=0),patch.object(host.os,'fdopen',return_value=io.BytesIO(frame({'action':action,'filename':'video.mp4'}))),patch.object(Path,'home',return_value=Path(tmp)),patch.object(host,'open_download') as opened,patch.object(sys,'stdout') as stdout:
   stdout.buffer=output;assert host.main()==0
   opened.assert_called_once_with(file.resolve(),reveal=action=='reveal-file')
  assert host.read_message(io.BytesIO(output.getvalue()))['status']=='done'
 with patch.object(host.subprocess,'run') as run:
  run.return_value.returncode=0;host.open_download(file,reveal=True);assert run.call_args.args[0]==['/usr/bin/open','-R',str(file)]
 with patch.object(sys,'platform','win32'),patch.object(host.os,'startfile',create=True) as start,patch.object(host,'windows_reveal') as reveal:
  host.open_download(file);start.assert_called_once_with(str(file));host.open_download(file,reveal=True);reveal.assert_called_once_with(file)

# Windows reveal uses a full-width PIDL, selects exactly the file, and releases COM memory.
import ctypes
shell=MagicMock();ole=MagicMock();ole.CoInitialize.return_value=0
shell.SHParseDisplayName.side_effect=lambda name,context,out,flags,attrs: setattr(out._obj,'value',123) or 0
shell.SHOpenFolderAndSelectItems.return_value=0
with patch.object(ctypes,'windll',SimpleNamespace(shell32=shell,ole32=ole),create=True):
 host.windows_reveal(Path('/fixture/video.mp4'))
 assert shell.SHOpenFolderAndSelectItems.call_args.args[0].value==123
 assert shell.SHOpenFolderAndSelectItems.call_args.args[1:]==(0,None,0)
 assert ole.CoTaskMemFree.call_args.args[0].value==123
 ole.CoUninitialize.assert_called_once()

# Yandex Music: complete album metadata, exact identity, no previews, saved audio.
import music
assert music.identity('https://music.yandex.ru/album/1750287/track/15608804')==('1750287','15608804')
assert music.identity('https://music.yandex.ru.evil/album/1') is None
assert [x['id'] for x in music.album_tracks({'id':1,'volumes':[[{'id':2}],[{'id':3},{'id':2}]]},'1')]==[2,3]
for data in [{'id':2,'volumes':[[{'id':1}]]},{'id':1,'volumes':[]},{'id':1,'volumes':[[{'id':i} for i in range(501)]]}]:
 try:music.album_tracks(data,'1')
 except music.MusicUnavailable:pass
 else:raise AssertionError('bad album accepted')
for formats in [[{'codec':'mp3','preview':True,'downloadInfoUrl':'https://example.com/a'}],[{'codec':'mp3','downloadInfoUrl':'https://example.com/a'}]]:
 try:music.full_format(formats)
 except music.MusicUnavailable:pass
 else:raise AssertionError('preview or unknown permission accepted')
formats=[{'codec':'mp3','preview':False,'downloadInfoUrl':'https://example.com/a','bitrateInKbps':v} for v in [128,320]]
assert music.full_format(formats)['bitrateInKbps']==320
xml=b'<download-info><host>example.com</host><path>/audio.mp3</path><ts>123</ts><s>public</s></download-info>'
assert music.direct_url(xml,host.valid_url).startswith('https://example.com/get-mp3/')
try:music.direct_url(xml.replace(b'example.com',b'127.0.0.1'),host.valid_url)
except music.MusicUnavailable:pass
else:raise AssertionError('private media allowed')
with tempfile.TemporaryDirectory() as tmp:
 target=Path(tmp);events=[]
 class AudioYDL:
  def process_ie_result(self,info,download):
   assert info['vcodec']=='none' and info['ext']=='mp3' and download
   path=target/(info['id']+'.mp3');path.write_bytes(b'audio');return {**info,'filepath':str(path)}
 def fake_api(path,guard):
  if path.startswith('albums/'):return {'id':1,'volumes':[[{'id':2,'title':'Two'},{'id':3,'title':'Three'}]]}
  if path.endswith('download-info'):return formats
  return [{'id':2,'title':'Two'}]
 with patch.object(music,'api',side_effect=fake_api),patch.object(music,'read',return_value=xml):
  music.download(AudioYDL(),'https://music.yandex.ru/album/1',target,lambda **x:events.append(x),host.valid_url)
 assert [x['completedUrl'] for x in events if 'completedUrl' in x]==['https://music.yandex.ru/album/1/track/2','https://music.yandex.ru/album/1/track/3']
 assert events[-1]['status']=='done' and 'filename' not in events[-1]
 # Failure partway through never reports the whole album done.
 events=[]
 with patch.object(music,'api',side_effect=fake_api),patch.object(music,'read',side_effect=[xml,music.MusicUnavailable('only preview')]):
  try:music.download(AudioYDL(),'https://music.yandex.ru/album/1',target,lambda **x:events.append(x),host.valid_url)
  except music.MusicUnavailable:pass
 assert not any(x['status']=='done' for x in events) and sum('completedUrl' in x for x in events)==1

# A public post-ad source is only a bounded fallback, not a way around source guards.
class MediaFallback:
 def __init__(self,error):self.calls=[];self.error=error;self.processed=0
 def extract_info(self,url,download,process=False):
  self.calls.append(url);return {'id':'content','title':'content'}
 def process_ie_result(self,info,download):
  self.processed+=1
  if self.processed==1:raise ValueError(self.error)
  return info
page='https://example.com/watch/1';media='https://cdn.example/main.m3u8'
ydl=MediaFallback('HTTP Error 403: Forbidden');called=[]
fallback=host.download_video(ydl,page,media,lambda:called.append(True))
assert len(fallback['id'])==16 and fallback['title']=='content' and fallback['webpage_url']==page
assert ydl.calls==[page,media] and called==[True]
for error in ['DRM encrypted source','sign in required','multiple videos: ambiguous source','Private/local network targets are disabled','disk full','HTTP Error 401']:
 ydl=MediaFallback(error)
 try:host.download_video(ydl,page,media)
 except ValueError:pass
 else:raise AssertionError('ineligible source failure allowed fallback')
 assert ydl.calls==[page]
ydl=MediaFallback('unsupported url')
try:host.download_video(ydl,page,'http://127.0.0.1/a.mp4')
except ValueError:pass
else:raise AssertionError('private fallback accepted')
assert ydl.calls==[page]
