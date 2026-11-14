import unittest
import numpy as np
from PIL import Image
from worker import correlation, EdgeGate, InstallGate, MessageGate, own_message, Recognizer, send_miao


class WorkerTests(unittest.TestCase):
    def test_match_known_patch_and_reject_flat(self):
        rng = np.random.default_rng(4)
        t = rng.integers(0, 255, (15, 20)).astype(float)
        frame = rng.integers(0, 255, (60, 90)).astype(float)
        frame[23:38, 17:37] = t
        scores = correlation(frame, t)
        self.assertEqual(np.unravel_index(scores.argmax(), scores.shape), (23, 17))
        self.assertAlmostEqual(scores[23, 17], 1.0)
        self.assertLess(correlation(np.zeros((40, 40)), t).max(), 0)

    def test_banner_rearm_and_install_not_on_focus_loss(self):
        g = EdgeGate()
        self.assertFalse(g.update(True, 0))
        self.assertTrue(g.update(True, .2))
        self.assertFalse(g.update(True, 20))
        g.update(False, 21);g.update(False, 22)
        g.update(True, 23)
        self.assertTrue(g.update(True, 23.2))
        install = InstallGate()
        self.assertFalse(install.update(True, 0, .3, .3))
        install.update(True, .4, .3, .3)
        self.assertFalse(install.update(False, .5, .3, .3))
        self.assertTrue(install.update(False, .9, .3, .3))
        self.assertFalse(install.update(False, 2, .3, .3))

    def test_old_chat_does_not_repeat_after_15s_and_new_row_can_trigger(self):
        g = MessageGate()
        g.update(1, 0)
        self.assertTrue(g.update(1, .2))
        for t in [5, 15, 30, 60]:
            self.assertFalse(g.update(1, t))
        g.update(2, 61)
        self.assertTrue(g.update(2, 61.2))
        self.assertFalse(g.update(1, 62))
        self.assertFalse(g.update(1, 62.2))

    def test_self_color_gate(self):
        im = Image.new('RGB', (100, 40), (0, 0, 0))
        im.paste((220, 190, 30), (1, 5, 20, 20))
        self.assertTrue(own_message(im, 50, 8, 14, .003))
        im.paste((20, 70, 220), (0, 0, 50, 40))
        self.assertFalse(own_message(im, 50, 8, 14, .003))

    def test_real_package_notes_template_at_reference_roi(self):
        r = Recognizer();r.configure(['notes']);r.setup((0, 0, 1920, 1080))
        frame = Image.new('RGB', (1920, 1080), (20, 20, 20))
        template = Image.open(r.assets/'templates/notes_banner.png').convert('RGB')
        frame.paste(template, (760, 240))
        self.assertFalse(r.process(frame, 0))
        events = r.process(frame, .2)
        self.assertEqual(events, [{'type':'trigger','card':'notes'}])
        self.assertFalse(r.process(frame, 45))
        r.setup((0, 0, 2560, 1600))
        self.assertTrue(r.profile)
        self.assertFalse(any(rule[0]['card']=='miao' for rule in r.rules))

    def test_send_sequence_and_focus_loss_and_failure_without_real_input(self):
        class Native:
            def __init__(self):self.keys=[];self.front=1;self.ok=True
            def game(self):return (self.front, ()) if self.front else None
            def send(self, vk, char):self.keys.append((vk,char));return self.ok
        n=Native();events=[]
        self.assertTrue(send_miao(n,lambda:True,events.append,lambda _:None))
        self.assertEqual(n.keys,[(13,0),(0,ord('喵')),(13,0)])
        self.assertEqual([e['type'] for e in events],['input-dispatched'])
        n=Native();events=[]
        self.assertFalse(send_miao(n,lambda:True,events.append,lambda _:setattr(n,'front',2)))
        self.assertEqual(n.keys,[(13,0)])
        self.assertEqual(events[-1]['type'],'input-error')
        n=Native();n.ok=False;events=[]
        self.assertFalse(send_miao(n,lambda:True,events.append,lambda _:None))
        self.assertEqual(len(n.keys),1)

    def test_real_miao_template_counts_only_own_new_rows(self):
        r=Recognizer();r.configure(['miao']);r.setup((0,0,1920,1080))
        frame=Image.new('RGB',(1920,1080),(20,20,20))
        tpl=Image.open(r.assets/'templates/miao_text.png').convert('RGB')
        def row(y,color):
            frame.paste(color,(10,y,90,y+tpl.height))
            frame.paste(tpl,(130,y))
        row(750,(40,80,240))
        r.process(frame,0);self.assertEqual(r.process(frame,.2),[])
        row(750,(230,200,20))
        r.process(frame,1);self.assertEqual(r.process(frame,1.2),[{'type':'trigger','card':'miao'}])
        self.assertEqual(r.process(frame,17),[])
        row(750+tpl.height+18,(230,200,20))
        r.process(frame,18);self.assertEqual(r.process(frame,18.2),[{'type':'trigger','card':'miao'}])


if __name__=='__main__':unittest.main()
