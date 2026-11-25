import base64
import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from app.backend.career import CareerStore
from app.backend.seed import initial_state
from app.backend.server import render_pdf
from app.backend.workflow import record_artifact

class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.state=initial_state();self.store=CareerStore(Path(self.temp.name))
        self.job=self.call('upsert',job={'title':'示例岗位','company':'示例公司','description':'AI产品需求分析','source':'manual'})['job']
    def call(self,action,**payload):return self.store.dispatch('/api/career/'+action,payload,self.state)
    def artifact(self):
        v=self.state['versions'][0];pdf,meta=render_pdf(self.state,v)
        return record_artifact(self.store,self.job,self.state,v,pdf,'demo.pdf',meta['pages'])
    def confirm(self,a,**extra):
        return self.call('submission-confirm',**({'jobId':self.job['id'],'artifactId':a['id'],'confirmed':True,'channel':'公司官网','submittedAt':'2026-01-01T10:30:00+08:00','requestId':'test-request-00001',**extra}))
    def test_partial_job_and_invalid_source_links(self):
        for value in ({'description':'只知道职责'},{'url':'https://jobs.example.com/1'}):
            j=self.call('upsert',job=value)['job'];self.assertEqual(j['title'],'岗位名称待补充')
        for value in ({},{'url':'javascript:alert(1)'},{'url':'https://user:pass@example.com'}):
            with self.assertRaises(ValueError):self.call('upsert',job=value)
    def test_decision_view_and_preparation_survive_refresh_without_rejection(self):
        ident=self.job['id'];self.call('view',id=ident)
        self.call('decision',id=ident,decision='skip',reason='通勤远')
        self.call('preparation',id=ident,preparation={'greeting':'真实经历待补','works':[{'label':'案例','url':'https://example.com/work'}]})
        j=self.call('upsert',job={'id':ident,'title':'更新标题'})['job']
        self.assertEqual(j['decision'],'skip');self.assertTrue(j['firstViewedAt']);self.assertEqual(j['status'],'saved');self.assertEqual(j['preparation']['greeting'],'真实经历待补')
        self.assertEqual(self.call('state')['preferences']['excludedCompanies'],[])
        j=self.call('decision',id=ident,decision='open',reason='重新考虑')['job'];self.assertEqual(j['decision'],'open')
    def test_plan_is_persistent_and_applying_does_not_mutate_preferences(self):
        before=self.call('state')['preferences'];p=self.call('plan-save',plan={'name':'深圳探索','filters':{'keyword':'产品','city':'深圳','page':1},'rules':{'hard':{'cities':['深圳']},'explore':{'roles':['AI产品']}}})['searchPlans'][0]
        self.assertEqual(self.call('state')['preferences'],before)
        self.assertEqual(self.call('state')['searchPlans'][0]['rules']['explore']['roles'],['AI产品'])
        self.call('plan-delete',id=p['id']);self.assertEqual(self.call('state')['searchPlans'],[])
    def test_confirm_uses_exact_export_even_after_resume_edit_and_is_idempotent(self):
        a=self.artifact();old=self.call('artifact',id=a['id']);self.assertEqual(self.call('state')['jobs'][0]['status'],'saved')
        self.state['profile']['name']='后来的姓名';self.state['versions'][0]['summary'][0]['text']='后来修改'
        self.call('upsert',mode='edit',job={'id':self.job['id'],'title':'后来的岗位名'})
        s=self.confirm(a)['submission'];self.assertEqual(self.confirm(a)['submission'],s)
        archived=self.call('artifact',id=a['id']);self.assertEqual(archived,old);self.assertEqual(self.call('state')['jobs'][0]['status'],'applied')
        self.assertEqual(len(self.call('state')['submissions']),1)
        self.assertEqual(hashlib.sha256(base64.b64decode(archived['pdfBase64'])).hexdigest(),a['pdfSha256'])
        self.assertNotIn('pdfBase64',self.call('state')['artifacts'][0])
        with self.assertRaises(ValueError):self.confirm(a,channel='邮件')
        with self.assertRaises(ValueError):self.call('delete',id=self.job['id'])
    def test_confirmation_and_association_are_required_and_no_progress_rewind(self):
        a=self.artifact()
        with self.assertRaises(ValueError):self.confirm(a,confirmed=False)
        with self.assertRaises(ValueError):self.confirm(a,submittedAt='2999-01-01T00:00:00+08:00')
        other=self.call('upsert',job={'title':'另一个岗位'})['job']
        with self.assertRaises(ValueError):self.confirm(a,jobId=other['id'])
        with self.assertRaises(ValueError):self.call('update',id=self.job['id'],status='applied')
        self.call('update',id=self.job['id'],status='interview');self.confirm(a)
        self.assertEqual(next(j for j in self.call('state')['jobs'] if j['id']==self.job['id'])['status'],'interview')
    def test_backup_includes_immutable_content_and_invalid_import_is_atomic(self):
        a=self.artifact();self.confirm(a);backup=self.call('backup');self.assertEqual(backup['schemaVersion'],4)
        self.call('import',backup=backup);self.assertEqual(self.call('artifact',id=a['id'])['pdfSha256'],a['pdfSha256'])
        for field in ('pdfBase64','snapshotSha256'):
            bad=copy.deepcopy(backup);bad['artifacts'][0][field]='corrupt'
            before=self.call('backup')
            with self.assertRaises(ValueError):self.call('import',backup=bad)
            after=self.call('backup');self.assertEqual(after['submissions'],before['submissions']);self.assertEqual(after['artifacts'],before['artifacts'])
        old=copy.deepcopy(backup);old['schemaVersion']=2
        for k in ('artifacts','submissions','searchPlans'):old.pop(k)
        self.call('import',backup=old);self.assertEqual(self.call('state')['artifacts'],[]);self.assertEqual(len(self.call('state')['jobs']),1)
    def test_invalid_material_url_cannot_replace_saved_preparation(self):
        self.call('preparation',id=self.job['id'],preparation={'greeting':'保留这段'})
        with self.assertRaises(ValueError):self.call('preparation',id=self.job['id'],preparation={'greeting':'替换','works':[{'label':'危险','url':'file:///private'}]})
        self.assertEqual(self.call('state')['jobs'][0]['preparation']['greeting'],'保留这段')

    def test_new_preferences_and_search_plan_backup_remain_compatible(self):
        prefs=self.call('state')['preferences'];prefs.update(recruitmentType='internship',cities=['成都市','香港'],roles=['机械工程师','手动方向'],keywords=['新能源'])
        self.call('preferences',preferences=prefs)
        self.call('plan-save',plan={'name':'实习探索','filters':{'keyword':'机械工程师','city':'香港','page':1,'recruitmentType':'internship','industry':['制造业']}})
        backup=self.call('backup');self.call('import',backup=backup)
        state=self.call('state');self.assertEqual(state['preferences'],prefs)
        self.assertEqual(state['searchPlans'][0]['filters']['recruitmentType'],'internship')
        self.assertEqual(state['searchPlans'][0]['filters']['industry'],['制造业'])
        bad=copy.deepcopy(backup);bad['preferences']['recruitmentType']='invalid'
        with self.assertRaises(ValueError):self.call('import',backup=bad)
        self.assertEqual(self.call('backup')['preferences'],prefs)
        legacy=copy.deepcopy(backup);legacy['preferences'].pop('recruitmentType');self.call('import',backup=legacy)
        self.assertEqual(self.call('state')['preferences']['recruitmentType'],'all')
