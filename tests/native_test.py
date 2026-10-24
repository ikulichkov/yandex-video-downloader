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
for bad in ['http://ok.ru/video/1','https://ok.ru.evil.test/video/1','file:///tmp/x','https://ok.ru:123/video/1']:assert not host.valid_url(bad)
assert host.valid_url('https://vkvideo.ru/video-234113842_456242445')
print('Native origin, ping, unknown commands, fixed-folder confinement, URL validation PASS')
