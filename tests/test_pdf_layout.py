import unittest
import copy
from seed import initial_state
from server import layout_blocks, render_pdf

class PDFLayoutTests(unittest.TestCase):
    def test_labels_have_one_chinese_colon_and_space_without_rewriting_data(self):
        state=initial_state();v=state['versions'][0]
        v['summary']=[{'label':'主题： ', 'text':'正文'}, {'label':'', 'text':'无主题正文'}]
        before=copy.deepcopy(state)
        blocks=layout_blocks(state,v,10)
        self.assertEqual(blocks[1]['p'].text,'<b>主题</b>： 正文')
        self.assertEqual(blocks[2]['p'].text,'无主题正文')
        self.assertEqual(state,before)

    def test_education_shares_heading_and_work_entries_have_an_eight_point_gap(self):
        state=initial_state();v=state['versions'][0];v['summary']=[]
        state['education']=[dict(heading='示例大学',detail='金融科技 / 硕士',date='2020–2023',bullets=[])]
        entry=dict(heading='示例公司 / 产品经理',date='2023–至今',bullets=[dict(label='产品',text='真实工作描述')])
        v['experience']=[copy.deepcopy(entry),copy.deepcopy(entry)]
        blocks=layout_blocks(state,v,10)
        self.assertIn('示例大学 金融科技 / 硕士',blocks[1]['left'].text)
        self.assertAlmostEqual(blocks[1]['lh'],blocks[1]['left'].style.leading)
        bullets=[b for b in blocks if b.get('bullet')]
        self.assertAlmostEqual(bullets[0]['height']-bullets[1]['height'],8)
        pdf,meta=render_pdf(state,v)
        self.assertTrue(pdf.startswith(b'%PDF'))
