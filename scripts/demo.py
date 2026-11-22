"""Create fictional examples in a NEW directory; never read or overwrite personal data."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from career import CareerStore
from seed import initial_state


def create_demo(destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    state = initial_state()
    state['profile'].update(name='示例候选人', englishName='Demo', email='candidate@example.com', location='深圳', showPhoto=False)
    state['education']=[dict(heading='示例大学', detail='经济学与计算机 / 本科', date='20XX–20XX', bullets=[])]
    for v in state['versions']:
        v['summary']=[dict(label='产品与技术',text='虚构演示：结合金融业务分析、产品设计与数据分析整理需求，参与 AI 应用验证。')]
        v['experience']=[dict(heading='示例科技 / 金融 SaaS 产品经理',date='20XX–至今',bullets=[dict(label='需求管理',text='虚构演示：梳理客户业务流程，编写需求说明，协调研发测试并记录验收结果。'),dict(label='AI 协作',text='虚构演示：将问题拆分成可验证任务，检查模型建议并保留人工确认。')])]
    (destination/'resumes.json').write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    store=CareerStore(destination)
    def call(action,**payload):return store.dispatch('/api/career/'+action,payload,state)
    job1=call('upsert',job=dict(title='产品经理（SaaS）', company='示例云软件（虚构）',city='深圳',salary='20–30K·13薪',url='https://jobs.example.com/saas',description='虚构 JD：负责 SaaS 产品需求梳理、原型设计和项目验收，了解金融业务。'))['job']
    job2=call('upsert',job=dict(title='AI 应用产品经理',company='示例智能（虚构）',city='广州',salary='22–32K',description='虚构 JD：关注 Agent 应用、模型评估及用户反馈，要求提供可验证项目。'))['job']
    for title,kind,start,end,job in [('SaaS 产品二面','interview','2026-11-25T14:00+08:00','2026-11-25T15:00+08:00',job1),('AI 产品笔试','test','2026-11-25T14:30+08:00','2026-11-25T16:00+08:00',job2),('作品集提交截止','deadline','2026-11-25T14:45+08:00','',job2)]:
        call('event-save',event=dict(title=title,kind=kind,start=start,end=end,jobId=job['id'],notes='纯虚构演示，不代表真实招聘或本人履历。'))
    return destination

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data-dir',required=True,type=Path)
    print(create_demo(p.parse_args().data_dir))
