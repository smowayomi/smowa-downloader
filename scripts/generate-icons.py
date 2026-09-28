from pathlib import Path
import json
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[1]
svg='''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="52" fill="#262a33" stroke="#3d4452" stroke-width="4"/><path d="M106 48H150V118H187L128 179L69 118H106Z" fill="#6cc0f2"/><path d="M61 177V205H195V177" fill="none" stroke="#4cc4a0" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/></svg>'''
(root/'src/download-icon.svg').write_text(svg)
scale=4
im=Image.new('RGBA',(256*scale,256*scale),(0,0,0,0));d=ImageDraw.Draw(im)
def box(v):return tuple(x*scale for x in v)
d.rounded_rectangle(box((8,8,248,248)),radius=52*scale,fill='#262a33',outline='#3d4452',width=4*scale)
d.polygon([box(v) for v in [(106,48),(150,48),(150,118),(187,118),(128,179),(69,118),(106,118)]],fill='#6cc0f2')
d.line([box(v) for v in [(61,177),(61,205),(195,205),(195,177)]],fill='#4cc4a0',width=18*scale,joint='curve')
for x,y in [(61,177),(195,177)]:d.ellipse(box((x-9,y-9,x+9,y+9)),fill='#4cc4a0')
master=im.resize((256,256),Image.Resampling.LANCZOS)
master.save(root/'src-tauri/icons/icon.png');master.save(root/'src-tauri/icons/icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
(root/'extension/icons').mkdir(exist_ok=True)
for size in [16,32,48,128]:im.resize((size,size),Image.Resampling.LANCZOS).save(root/f'extension/icons/icon-{size}.png')
(root/'src-tauri/icons/tray.rgba').write_bytes(im.resize((32,32),Image.Resampling.LANCZOS).tobytes())
