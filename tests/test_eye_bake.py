import importlib.util
import json
import unittest
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
RIG=ROOT/'puppet/rig'
SPEC=importlib.util.spec_from_file_location('eyes',ROOT/'tools/build_eye_blinks.py')

class EyeBakeTest(unittest.TestCase):
    def test_eye_only_replacement_preserves_every_other_pixel(self):
        self.assertTrue(Path(SPEC.origin).exists(),'missing local-eye blink baker')
        module=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(module)
        cfg=json.loads((RIG/'js/assets.js').read_text(encoding='utf-8-sig').split('=',1)[1].strip().rstrip(';'))['baijie']
        closed=Image.open(RIG/'assets/baijie-face-3625.png').convert('RGBA')
        for key,f in cfg['faces'].items():
            with self.subTest(face=key):
                source=Image.open(RIG/f'assets/baijie-face-{key}.png').convert('RGBA')
                before=np.asarray(source).copy()
                result=module.close_eyes(source,closed,f,cfg['faces']['3625'],int(key))
                after=np.asarray(result)
                self.assertEqual(result.size,source.size)
                mask=module.eye_mask(source.size,f)
                np.testing.assert_array_equal(after[mask==0],before[mask==0])
                # Brows and the entire lower face must remain byte-identical.
                yy=np.arange(source.height)[:,None]+f['y']
                protected=np.broadcast_to((yy<81)|(yy>=113),(source.height,source.width))
                np.testing.assert_array_equal(after[protected],before[protected])
                if int(key) in module.NO_BLINK:
                    np.testing.assert_array_equal(before,after)
                else:
                    self.assertGreater(np.count_nonzero(before!=after),100)
                    self.assertTrue(np.any(np.asarray(result)[:,:,3]>0))
                np.testing.assert_array_equal(np.asarray(source),before)

if __name__=='__main__': unittest.main()
