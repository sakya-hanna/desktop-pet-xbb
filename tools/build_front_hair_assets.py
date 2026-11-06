"""Build front-hair trial assets from candidate 16; Pillow only, no app launch.
Existing outer-lock assets and all user data are read-only. --source-root is the art handoff root.
"""
from pathlib import Path
from PIL import Image,ImageChops,ImageFilter
import hashlib,json,argparse
SPECS=[('fringe',(1360,220,1620,540),330,478,40,0.12,(2,8),1.2),('front-left',(1040,760,1320,1170),825,1133,80,0.0,(2,3),1.1),('front-right',(1760,1080,1950,1310),1120,1276,40,-0.10,(2,3),1.1)]
def maximum(im):
 r,g,b,a=im.split();return ImageChops.lighter(ImageChops.lighter(r,g),ImageChops.lighter(b,a))
def build(art_root,output,legacy_assets):
 art_root=Path(art_root);output=Path(output);legacy_assets=Path(legacy_assets);f14=art_root/'14-美术候选-左贴身发续作-20261105';f15=art_root/'15-美术候选-右贴身发-20261105';f16=art_root/'16-美术候选-三束联动与轻影-20261105';provenance=[]
 expected={r['path']:r['sha256'] for r in json.loads((f16/'evidence/before-inventory.json').read_text(encoding='utf-8'))['files']}
 expected.update({(f16.relative_to(art_root)/r['path']).as_posix():r['sha256'] for r in json.loads((f16/'evidence/output-manifest.json').read_text(encoding='utf-8'))})
 def load(p,mode='RGBA'):
  p=Path(p);h=hashlib.sha256(p.read_bytes()).hexdigest()
  try:rel=p.relative_to(art_root).as_posix()
  except ValueError:rel=str(p)
  if rel in expected and h!=expected[rel]:raise ValueError('Art source changed: '+rel)
  provenance.append({'path':rel,'sha256':h});return Image.open(p).convert(mode)
 source=load(art_root/'02-美术源素材/baijie-src/白__白Ａ_0_2788.png');original=load(legacy_assets/'baijie-body.png');base=load(legacy_assets/'baijie-layered-body.png');outer=[load(legacy_assets/n) for n in ['baijie-outer-left.png','baijie-outer-right.png']]
 if original.size!=(530,800) or source.size!=(2612,3941):raise ValueError('Unexpected legacy/source canvas')
 if maximum(ImageChops.difference(source.resize(original.size,Image.Resampling.LANCZOS).convert('RGBa'),original.convert('RGBa'))).getbbox():raise ValueError('Legacy body no longer matches the source bake')
 repaired=load(f16/'assets/三束补底-无表情无发影.png').resize(original.size,Image.Resampling.LANCZOS);delta=maximum(ImageChops.difference(repaired.convert('RGBa'),original.convert('RGBa'))).point(lambda v:255 if v else 0)
 for lock in outer:
  if ImageChops.multiply(delta,lock.getchannel('A')).getbbox():raise ValueError('Repair touches an existing outer-lock ownership region')
 base.paste(repaired,(0,0),delta);assets=output/'assets';assets.mkdir(parents=True,exist_ok=True);(output/'js').mkdir(parents=True,exist_ok=True);base.save(assets/'baijie-front-body.png')
 hair_files=[f16/'assets/中央刘海-PS原层.png',f14/'assets/左前卷发-PS钢笔蒙版层.png',f15/'assets/右主卷发-PS钢笔蒙版层.png'];parts=[]
 for i,(name,box,root,tip,amplitude,phase,offset,blur) in enumerate(SPECS):
  hair=load(hair_files[i]).crop(box);ha=hair.getchannel('A');caster=Image.new('RGBA',hair.size,(255,255,255,0));caster.putalpha(ha.filter(ImageFilter.GaussianBlur(blur)))
  if i==0:
   recv=load(art_root/'11-美术候选-刘海发影-20261105/assets/额头接影区域-局部.png','L').crop((box[0]-1180,box[1]-180,box[2]-1180,box[3]-180));near=ha.filter(ImageFilter.MaxFilter(5))
   for y in range(299,400):
    for x in range(1568,1600):
     q=(x-box[0],y-box[1])
     if near.getpixel(q)==0:recv.putpixel(q,0)
   receiver=Image.new('RGBA',hair.size,(238,123,95,0));receiver.putalpha(recv.point(lambda v:round(v*60/255)))
  else:
   key='left' if i==1 else 'right';recv=load(f16/'assets'/f'{key}-固定接影区域.png','L');receiver=load(f16/'assets'/f'{key}-材质分区影色.png').convert('RGBA');strength=Image.new('L',hair.size,24)
   if i==1:
    skin=load(f14/'assets/08_肩部上臂皮肤补底.png').getchannel('A').crop(box);cloth=load(f14/'assets/09_白色肩带补底.png').getchannel('A').crop(box)
    for y in range(hair.height):
     for x in range(hair.width):
      a=skin.getpixel((x,y));c=min(1,cloth.getpixel((x,y))/a) if a else 0;strength.putpixel((x,y),round(26*(1-c)+18*c))
   receiver.putalpha(ImageChops.multiply(recv,strength))
  names={'texture':f'baijie-{name}.png','caster':f'baijie-{name}-caster.png','receiver':f'baijie-{name}-receiver.png'}
  for field,im in [('texture',hair),('caster',caster),('receiver',receiver)]:im.save(assets/names[field])
  parts.append(dict(name=name,sourceBox=[box[0],box[1],hair.width,hair.height],textureSize=list(hair.size),root=root,tip=tip,amplitude=amplitude,motion=dict(follow='right' if i==2 else 'left',stiffness=[110,80,110][i],damping=12),phase=phase,shadowOffset=list(offset),**names))
 config={'version':4,'motionModel':'outer-follow-wide-v1','canvas':[530,800],'sourceCanvas':[2612,3941],'body':'baijie-front-body.png','periodSeconds':4.8,'parts':parts}
 report={'sourceCandidate':'16-美术候选-三束联动与轻影-20261105','sourceCanvas':[2612,3941],'runtimeCanvas':[530,800],'changesTouchingOuterLayers':0,'newBodyDeltaBBox':delta.getbbox(),'newBodyChangedPixels':delta.histogram()[255],'casterModel':'Unoccluded blurred source alpha, sampled with current root-pinned displacement; receiver/material stays fixed and fringe occlusion is evaluated at render time. Normal-amplitude trial, not full-pose lighting.','sourceFiles':provenance}
 (output/'js/front-hair-assets.js').write_text('// Generated by tools/build_front_hair_assets.py; existing outer assets remain separate.\nwindow.FRONT_HAIR_ASSETS = '+json.dumps({'baijie':config},ensure_ascii=False,indent=2)+';\n',encoding='utf-8');(output/'front-hair-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');return {'config':config,'report':report}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-root',type=Path,default=Path(__file__).resolve().parents[2]);p.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'puppet/rig');p.add_argument('--legacy-assets',type=Path);a=p.parse_args();print(json.dumps(build(a.source_root,a.output,a.legacy_assets or a.output/'assets')['report'],ensure_ascii=False,indent=2))
