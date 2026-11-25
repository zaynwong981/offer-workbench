"""Create fictional examples in a NEW directory; never read or overwrite personal data."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.backend.career import CareerStore
from app.backend.seed import initial_state


def create_demo(destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    state = initial_state()
    state['profile'].update(name='林知远（虚构示例）', englishName='', email='candidate@example.com', location='示例城市', showPhoto=False)
    state['education']=[
        dict(heading='示例国际商学院／示例大学｜商学院',detail='金融科技与风险控制｜硕士',date='20XX—20XX',bullets=[dict(label='核心课程',text='AI与机器学习、数据挖掘、金融大数据、风险管理与公司理财。'),dict(label='语言与证书（虚构）',text='大学英语四级608分，雅思7.0，CPA一级通过。')]),
        dict(heading='示例大学｜交叉学科培养项目',detail='经济学＆计算机科学与技术｜本科双学士',date='20XX—20XX',bullets=[])]
    for v in state['versions']:
        v['summary']=[dict(label='AI应用与产品判断',text='围绕资讯生成、风险文本分析和内部助手等业务任务开展需求分析、工作流设计、提示词优化与效果评估，关注输出依据及异常处理。'),dict(label='跨团队协作',text='具备经济学、计算机与金融科技复合背景，使用Python、SQL及工作流工具分析数据，以AI辅助原型开发和验收，把业务规则转化为可验证的产品要求。')]
        v['experience']=[
            dict(heading='示例企业服务公司｜产品团队｜AI产品经理',date='20XX—至今',bullets=[dict(label='内部助手落地',text='设计团队资讯助手，配置资讯整理和问题登记流程，梳理成员权限、发布确认与异常处理，完成专用环境部署和测试后供团队试用。'),dict(label='AI辅助需求与原型',text='使用AI整理访谈与用户旅程，迭代客户线索小程序的筛选、查看和跟进原型，核对关键操作埋点，并与研发测试共同确认验收范围。'),dict(label='金融AI体验评估',text='从审批任务出发评估授信辅助与贷中监控方案，提出报告证据追溯、风险解释和上下文引导建议，记录采纳情况与待验证问题。')]),
            dict(heading='示例内容平台｜内容产品组｜产品策划实习',date='20XX—20XX',bullets=[dict(label='资讯产品策划',text='通过用户访谈和竞品研究明确资讯聚合产品的最小可用版本，调试财经摘要提示词，将内容审核要求纳入生成流程。'),dict(label='内容模型评估',text='整理推广内容识别标准，协调语料采集、标注与反馈，区分漏检和误判，依据回归样本推动模型验收与迭代。')]),
            dict(heading='示例消费金融公司｜智能应用组｜算法实习',date='20XX—20XX',bullets=[dict(label='风险文本工作流',text='使用大模型分析合成信用报告，在工作流工具中组织风险特征推理，通过提示词调整、样本核验和业务复核筛选候选变量。'),dict(label='数据与效果验证',text='使用SQL进行样本清洗、特征组合与分组分析，结合机器学习训练检查变量稳定性，记录适用场景与局限。')]),
            dict(heading='示例金融信息公司｜数据产品组｜数据产品实习',date='20XX—20XX',bullets=[dict(label='文档智能解析',text='参与金融文档表格识别产品，处理训练样本、执行评估与推理，汇总错误类型并反馈模型调整，按验收集确认上线条件。')]),
            dict(heading='示例商业银行｜零售业务组｜客户经理',date='20XX—20XX',bullets=[dict(label='金融需求理解',text='根据客户风险偏好和流动性需求整理资产配置建议，记录需求变化与服务反馈，将一线业务问题转化为产品改善线索。')])]
    (destination/'resumes.json').write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    store=CareerStore(destination)
    def call(action,**payload):return store.dispatch('/api/career/'+action,payload,state)
    job1=call('upsert',job=dict(title='产品经理（SaaS）', company='示例云软件（虚构）',city='深圳',salary='20–30K·13薪',url='https://jobs.example.com/saas',description='虚构岗位详情：负责 SaaS 产品需求梳理、原型设计和项目验收，了解金融业务。'))['job']
    job2=call('upsert',job=dict(title='AI 应用产品经理',company='示例智能（虚构）',city='广州',salary='22–32K',description='虚构岗位详情：关注 Agent 应用、模型评估及用户反馈，要求提供可验证项目。'))['job']
    for title,kind,start,end,job in [('SaaS 产品二面','interview','2026-11-25T14:00+08:00','2026-11-25T15:00+08:00',job1),('AI 产品笔试','test','2026-11-25T14:30+08:00','2026-11-25T16:00+08:00',job2),('作品集提交截止','deadline','2026-11-25T14:45+08:00','',job2)]:
        call('event-save',event=dict(title=title,kind=kind,start=start,end=end,jobId=job['id'],notes='纯虚构演示，不代表真实招聘或本人履历。'))
    return destination

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data-dir',required=True,type=Path)
    print(create_demo(p.parse_args().data_dir))
