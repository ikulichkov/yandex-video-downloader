"""Public Yandex Music audio adapter. Never imports account credentials or previews."""
import hashlib, json, re
from urllib.parse import urlsplit
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from xml.etree import ElementTree

class MusicUnavailable(ValueError): pass

def identity(url):
    u=urlsplit(url)
    if u.scheme not in ('http','https') or not re.fullmatch(r'music\.yandex\.(ru|com|kz|by|ua)',u.hostname or '') or u.username or u.password or u.port: return None
    m=re.fullmatch(r'/album/(\d+)(?:/track/(\d+))?/?',u.path)
    return (m[1],m[2]) if m else None

def read(url,valid_url):
    if not valid_url(url):raise MusicUnavailable('Недопустимый адрес музыки.')
    with urlopen(Request(url,headers={'User-Agent':'YandexVideoDownloader/2.3'}),timeout=20) as response:
        if not valid_url(response.url):raise MusicUnavailable('Недопустимый адрес музыки.')
        data=response.read(4*1024*1024+1)
    if len(data)>4*1024*1024:raise MusicUnavailable('Ответ музыкального сервиса слишком большой.')
    return data

def api(path,valid_url):
    try:result=json.loads(read('https://api.music.yandex.net/'+path,valid_url))
    except HTTPError as exc:
        if exc.code in (401,403):raise MusicUnavailable('Яндекс Музыка требует доступ к полной записи. Вход браузера не передаётся помощнику.') from None
        if exc.code==429:raise MusicUnavailable('Яндекс Музыка ограничила запросы. Повторите позже.') from None
        raise
    if 'result' not in result:raise MusicUnavailable('Яндекс Музыка не предоставила данные. Возможны ограничения доступа.')
    return result['result']

def album_tracks(data,album):
    if str(data.get('id'))!=album:raise MusicUnavailable('Альбом не совпал с выбранным.')
    tracks=[];seen=set()
    for volume in data.get('volumes') or []:
        for track in volume:
            tid=str(track.get('id',''))
            if not tid.isdigit():raise MusicUnavailable('Не удалось определить трек альбома.')
            if tid not in seen:tracks.append(track);seen.add(tid)
            if len(tracks)>500:raise MusicUnavailable('Альбом содержит больше 500 треков.')
    if not tracks:raise MusicUnavailable('В альбоме нет доступных треков.')
    return tracks

def full_format(formats):
    # A preview is never an acceptable substitute for a full track.
    candidates=[x for x in formats if x.get('preview') is False and x.get('codec')=='mp3' and x.get('downloadInfoUrl') and not x.get('drm')]
    if not candidates:raise MusicUnavailable('Яндекс Музыка предоставляет только превью или требует доступ к полной записи. Полный трек не скачан.')
    return max(candidates,key=lambda x:int(x.get('bitrateInKbps') or 0))

def direct_url(data,valid_url):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():raise MusicUnavailable('Недопустимый ответ музыки.')
    root=ElementTree.fromstring(data)
    host,path,ts,s=(root.findtext(k) for k in ('host','path','ts','s'))
    if not all(isinstance(x,str) and x for x in (host,path,ts,s)) or not path.startswith('/') or not ts.isdigit():raise MusicUnavailable('Нет ссылки на полный трек.')
    # Public service URL construction, also used by yt-dlp's YandexMusic extractor.
    sign=hashlib.md5(('XGRlBW9FXlekgbPrRHuSiA'+path[1:]+s).encode()).hexdigest()
    url=f'https://{host}/get-mp3/{sign}/{ts}{path}'
    if not valid_url(url):raise MusicUnavailable('Недопустимый адрес трека.')
    return url

def download(ydl,url,target,emit,valid_url,on_track=None):
    album,tid=identity(url)
    if tid:
        values=api('tracks/'+tid+':'+album,valid_url)
        tracks=[x for x in values if str(x.get('id'))==tid]
        if len(tracks)!=1:raise MusicUnavailable('Не найден выбранный трек.')
    else:tracks=album_tracks(api('albums/'+album+'/with-tracks',valid_url),album)
    count=len(tracks)
    for index,track in enumerate(tracks,1):
        if on_track:on_track(index,count)
        track_id=str(track['id']);track_url=f'https://music.yandex.ru/album/{album}/track/{track_id}'
        emit(status='progress',text=f'Трек {index} из {count}: {track.get("title", "Музыка")}',percent=round((index-1)*100/count))
        fmt=full_format(api('tracks/'+track_id+':'+album+'/download-info',valid_url))
        media=direct_url(read(fmt['downloadInfoUrl'],valid_url),valid_url)
        artists=', '.join(str(x.get('name','')) for x in track.get('artists',[]))
        info={'id':track_id,'title':(artists+' — ' if artists else '')+track.get('title',track_id),'url':media,'ext':'mp3','vcodec':'none','acodec':'mp3','abr':fmt.get('bitrateInKbps'),'duration':(track.get('durationMs') or 0)/1000,'webpage_url':track_url}
        saved=ydl.process_ie_result(info,download=True)
        from pathlib import Path
        file=Path(saved.get('filepath') or ydl.prepare_filename(saved))
        if not file.is_file() or file.stat().st_size==0 or file.is_symlink() or file.resolve().parent!=target.resolve():raise MusicUnavailable('Не удалось сохранить полный трек.')
        emit(status='progress',text=f'Сохранено {index} из {count}',percent=round(index*100/count),completedUrl=track_url,completedFilename=str(file),completedTitle=info['title'])
    emit(status='done',text=f'Сохранено треков: {count}. Загрузки/Яндекс Видео',**({'filename':str(file)} if tid else {}))
