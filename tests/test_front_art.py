from pathlib import Path
from PIL import Image,ImageChops
import unittest,importlib.util,tempfile,os,hashlib
PROJECT=Path(__file__).resolve().parents[1];ART=Path(os.environ.get('BAIJIE_ART_ROOT',PROJECT.parent));SCRATCH=Path(tempfile.gettempdir())
class FrontAssetBuildTests(unittest.TestCase):
 def test_art_bundle_adds_three_strands_without_replacing_existing_outer_hair(self):
  path=PROJECT/'tools/build_front_hair_assets.py';self.assertTrue(path.is_file(),'The new art bundle builder must exist before a deploy can be made')
  spec=importlib.util.spec_from_file_location('front_asset_builder',path);builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder);legacy=PROJECT/'puppet/rig/assets';before={n:hashlib.sha256((legacy/n).read_bytes()).hexdigest() for n in ['baijie-body.png','baijie-layered-body.png','baijie-outer-left.png','baijie-outer-right.png']}
  with tempfile.TemporaryDirectory(dir=SCRATCH) as d:
   result=builder.build(ART,Path(d),legacy);cfg=result['config'];self.assertEqual(cfg['canvas'],[530,800]);self.assertEqual([p['name'] for p in cfg['parts']],['fringe','front-left','front-right']);self.assertEqual(result['report']['changesTouchingOuterLayers'],0)
   self.assertEqual(cfg['version'],4);self.assertEqual(cfg['motionModel'],'outer-follow-wide-v1')
   self.assertEqual([p['amplitude'] for p in cfg['parts']],[40,80,40])
   for i,part in enumerate(cfg['parts']):self.assertEqual(part['motion'],dict(follow='right' if i==2 else 'left',stiffness=[110,80,110][i],damping=12))
   self.assertEqual((Path(d)/'js/front-hair-assets.js').read_bytes(),(PROJECT/'puppet/rig/js/front-hair-assets.js').read_bytes())
   for generated in (Path(d)/'assets').glob('*.png'):self.assertEqual(generated.read_bytes(),(legacy/generated.name).read_bytes(),generated.name+' art bytes must be unchanged')
   with Image.open(Path(d)/'assets'/cfg['body']) as image:
    self.assertEqual(image.size,(530,800))
    with Image.open(legacy/'baijie-layered-body.png') as old:self.assertIsNone(ImageChops.difference(image.getchannel('A'),old.getchannel('A')).getbbox())
   for part in cfg['parts']:
    for name in ['texture','caster','receiver']:
     with Image.open(Path(d)/'assets'/part[name]) as image:self.assertEqual(image.size,tuple(part['textureSize']))
    with Image.open(Path(d)/'assets'/part['receiver']) as image:self.assertLessEqual(image.getchannel('A').getextrema()[1],60 if part['name']=='fringe' else 26)
    with Image.open(Path(d)/'assets'/part['texture']) as hair,Image.open(Path(d)/'assets'/part['caster']) as caster:
     bbox=hair.getchannel('A').getbbox();margin=min(bbox[0],hair.width-bbox[2]);self.assertGreaterEqual(margin,30)
     # Global bbox margin ignores pinned roots. Check actual row-dependent motion
     # on padded alpha so cropping cannot hide displaced hair/caster outside the expanded output canvas (source UV crop stays unchanged).
     for image in [hair,caster]:
      alpha=image.getchannel('A');pad=int(part['amplitude']+12);w,h=image.size
      for offset in [-part['amplitude'],part['amplitude']]:
       moved=Image.new('L',(w+2*pad,h))
       for y in range(h):
        t=max(0,min(1,(y+.5+part['sourceBox'][1]-part['root'])/(part['tip']-part['root'])));gain=t*t*t*(t*(t*6-15)+10)
        row=Image.new('L',(w+2*pad,1));row.paste(alpha.crop((0,y,w,y+1)),(pad,0))
        shifted=row.transform(row.size,Image.Transform.AFFINE,(1,0,-offset*gain,0,1,0),resample=Image.Resampling.BILINEAR)
        moved.paste(shifted,(0,y))
        if gain==0:self.assertIsNone(ImageChops.difference(row,shifted).getbbox(),'Pinned roots must not move')
       self.assertIsNone(moved.crop((0,0,2,h)).getbbox(),'Negative envelope clipped')
       self.assertIsNone(moved.crop((w+2*pad-2,0,w+2*pad,h)).getbbox(),'Positive envelope clipped')
     self.assertIsNotNone(ImageChops.multiply(hair.getchannel('A'),caster.getchannel('A')).getbbox(),'Unoccluded caster interior must not be punched out at the rest pose')
   self.assertTrue((Path(d)/'js/front-hair-assets.js').is_file())
  self.assertEqual(before,{n:hashlib.sha256((legacy/n).read_bytes()).hexdigest() for n in before})
if __name__=='__main__':unittest.main(verbosity=2)
