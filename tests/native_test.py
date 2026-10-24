import importlib.util, io, json, struct, subprocess, sys, tempfile
from pathlib import Path
from unittest.mock import patch
root=Path(__file__).resolve().parent.parent
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
 def extract_info(self,url,download):
  assert download is False
  return {'_type':'playlist','entries':[{'id':'first'}]}
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
