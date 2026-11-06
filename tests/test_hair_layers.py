import importlib.util
import unittest
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('hair', ROOT / 'tools/build_hair_layers.py')

class HairLayersTest(unittest.TestCase):
    def test_outer_hair_preserves_body_and_rest_reconstruction(self):
        self.assertTrue(Path(spec.origin).exists(), 'missing independent hair-layer baker')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        source = Image.open(ROOT/'puppet/rig/assets/baijie-body.png').convert('RGBA')
        body, layers, report = module.split_layers(source)
        result = body.copy()
        for _, layer in layers:
            result.alpha_composite(layer)
        np.testing.assert_array_equal(np.asarray(source), np.asarray(result))
        original = np.asarray(source)
        altered = np.asarray(body)
        protected = module.protected_mask(source.size)
        np.testing.assert_array_equal(original[protected], altered[protected])
        self.assertEqual(len(layers), 2)
        for name, layer in layers:
            self.assertGreater(np.count_nonzero(np.asarray(layer)[:,:,3]), 2500, name)
        self.assertEqual(report['reconstruction_max_error'], 0)

if __name__ == '__main__': unittest.main()
