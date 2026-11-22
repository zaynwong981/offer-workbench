import json
from pathlib import Path
import tempfile
import unittest
from scripts.demo import create_demo
from scripts.snapshot import snapshot,restore
from career import CareerStore

class ReleaseTests(unittest.TestCase):
    def test_demo_snapshot_restore_and_corruption_refusal(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=create_demo(root/'demo')
            with self.assertRaises(FileExistsError):create_demo(source)
            config=root/'config.json';config.write_text('{"exportDir":"./exports"}')
            snap=snapshot(source,root/'backup',config)
            result=restore(snap,root/'restore')
            self.assertEqual((source/'resumes.json').read_bytes(),(result/'data/resumes.json').read_bytes())
            db=CareerStore(result/'data');state=db.dispatch('/api/career/state',{},json.loads((source/'resumes.json').read_text(encoding="utf-8")))
            self.assertEqual(len(state['jobs']),2);self.assertEqual(len(state['events']),3)
            self.assertEqual(len(state['conflicts']),3)
            with self.assertRaises(ValueError):restore(snap,result)
            with self.assertRaises(ValueError):snapshot(source,source/'nested')
            (snap/'data/resumes.json').write_text('tampered')
            with self.assertRaises(ValueError):restore(snap,root/'bad')
            self.assertFalse((root/'bad').exists())
