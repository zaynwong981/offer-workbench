import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from app.backend import assistant, llm
from app.backend.career import CareerStore
from app.backend.seed import initial_state
from app.backend.server import validate_state,render_pdf
from scripts.snapshot import snapshot,restore

class AssistantTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.store=CareerStore(self.root/'data');self.state=initial_state();self.state['profile']['phone']='private-contact';self.state['profile']['photo']=''
        self.state['versions'][0]['summary'][0]['text']='负责需求分析，整理3份验收记录。'
        self.config=llm.Config(self.root/'data');self.config.save({**llm.DEFAULT,'enabled':True,'model':'synthetic-model','apiKey':'synthetic-secret'})
    def call(self,action,**payload):return self.store.dispatch('/api/career/'+action,payload,self.state)
    def material(self,**extra):
        return self.call('material-save',material={'title':'合成需求案例','body':'负责需求分析，整理3份验收记录。','kind':'project','source':'合成验收记录','verification':'verified',**extra})['material']
    def preview(self,task='rewrite',**extra):
        return assistant.prepare(self.store,{'task':task,'target':{'versionId':'saas','path':['summary',0]},**extra},self.state)
    def generate(self,d,result):
        with patch.object(llm,'call',return_value=(json.dumps(result,ensure_ascii=False),{'input_tokens':20,'output_tokens':20})) as call:
            value=assistant.generate(self.store,{'id':d['id'],'confirmed':True});self.assertEqual(call.call_count,1);return value
    def test_material_revision_conflict_and_required_source(self):
        m=self.material();changed={**m,'body':'新内容'};self.call('material-save',material=changed)
        with self.assertRaises(ValueError):self.call('material-save',material=changed)
        with self.assertRaises(ValueError):self.call('material-delete',id=m['id'],revision=m['revision'])
        with self.assertRaises(ValueError):self.material(source='')
        self.assertEqual(self.call('assist-state')['materials'][0]['body'],'新内容')
    def test_preview_is_no_network_exact_scope_and_one_use(self):
        m=self.material()
        with patch.object(llm,'call') as remote:
            d=self.preview(materialIds=[m['id']]);remote.assert_not_called()
            with self.assertRaises(ValueError):assistant.generate(self.store,{'id':d['id']})
        encoded=json.dumps(d,ensure_ascii=False);self.assertNotIn('private-contact',encoded);self.assertNotIn('synthetic-secret',encoded)
        self.assertIn('负责需求分析',encoded)
        result=self.generate(d,{'text':'负责需求分析并整理3份验收记录。','evidence':[{'materialId':m['id'],'quote':m['body']}],'questions':[]})
        self.assertEqual(result['status'],'ready')
        with self.assertRaises(ValueError):assistant.generate(self.store,{'id':d['id'],'confirmed':True})
    def test_accept_undo_and_concurrent_edit_refusal(self):
        d=self.generate(self.preview(),{'text':'负责需求分析并整理3份验收记录。','evidence':[]})
        before=copy.deepcopy(self.state)
        with self.assertRaises(ValueError):assistant.apply(self.store,{'id':d['id']},self.state)
        value,text=assistant.apply(self.store,{'id':d['id'],'verified':True},self.state);assistant.finish_apply(self.store,value,text)
        self.assertNotEqual(self.state,before)
        self.state['versions'][0]['summary'][0]['text']='之后手动编辑'
        with self.assertRaises(ValueError):assistant.apply(self.store,{'id':d['id']},self.state,True)
        self.state['versions'][0]['summary'][0]['text']=text
        value,text=assistant.apply(self.store,{'id':d['id']},self.state,True);assistant.finish_apply(self.store,value,text,True)
        self.assertEqual(self.state,before)
    def test_invented_numbers_bad_quotes_and_failure_keep_original(self):
        before=copy.deepcopy(self.state);m=self.material()
        for result in ({'text':'提升效率90%','evidence':[]},{'text':'负责需求分析','evidence':[{'materialId':m['id'],'quote':'并不存在'}]}):
            d=self.generate(self.preview(materialIds=[m['id']]),result);self.assertEqual(d['status'],'failed');self.assertTrue(d['rawOutput'])
        d=self.preview()
        with patch.object(llm,'call',side_effect=ValueError('网络不可用')):
            result=assistant.generate(self.store,{'id':d['id'],'confirmed':True})
        self.assertEqual(result['status'],'failed');self.assertTrue(result['request']);self.assertEqual(self.state,before)
    def test_config_change_requires_new_preview_and_clears_old_key(self):
        d=self.preview();self.config.save({**llm.DEFAULT,'provider':'deepseek','baseUrl':'https://api.deepseek.com','protocol':'chat','model':'test','enabled':True})
        self.assertFalse(self.config.public()['hasKey'])
        with self.assertRaises(ValueError):assistant.generate(self.store,{'id':d['id'],'confirmed':True})
        self.assertNotIn('apiKey',self.config.public())
        if os.name!='nt':self.assertEqual(self.config.path.stat().st_mode&0o777,0o600)
    def test_budget_rejection_and_fixed_test_has_no_materials(self):
        self.config.save({**self.config.public(),'dailyRequests':1})
        d=self.preview(task='test',materialIds=['missing']);self.assertEqual(d['input'],{});self.assertNotIn('private-contact',json.dumps(d))
        with patch.object(llm,'call',return_value=('OK',{})):self.assertEqual(assistant.generate(self.store,{'id':d['id'],'confirmed':True})['status'],'ready')
        with patch.object(llm,'call') as remote:
            with self.assertRaises(ValueError):assistant.generate(self.store,{'id':self.preview()['id'],'confirmed':True})
            remote.assert_not_called()
    def test_backup_v4_legacy_and_corruption_atomic_no_secrets(self):
        self.material();d=self.preview();backup=self.call('backup');self.assertEqual(backup['schemaVersion'],4)
        self.assertNotIn('synthetic-secret',json.dumps(backup));self.call('import',backup=backup)
        restored=self.call('assist-state');self.assertEqual(restored['aiDrafts'][0]['status'],'imported')
        bad=copy.deepcopy(backup);bad['materials'][0]['verification']='invalid'
        with self.assertRaises(ValueError):self.call('import',backup=bad)
        self.assertEqual(self.call('assist-state'),restored)
        old=copy.deepcopy(backup);old['schemaVersion']=3;old.pop('materials');old.pop('aiDrafts');self.call('import',backup=old)
        self.assertEqual(self.call('assist-state')['materials'],[]);self.assertTrue(self.config.public()['hasKey'])
        snap=snapshot(self.store.path.parent,self.root/'snap');self.assertFalse((snap/'data/.secrets').exists());restore(snap,self.root/'restored')
    def test_jd_statistics_denominator_duplicates_quotes_and_extra_terms(self):
        a=self.call('upsert',job={'title':'产品','description':'需要需求分析。负责ERP。需求分析。'})['job'];b=self.call('upsert',job={'title':'空岗位'})['job']
        r=self.call('jd-insights',jobIds=[a['id'],a['id'],b['id']],keywords='ERP')
        self.assertEqual((r['selected'],r['sampleSize'],r['missingJD']),(2,1,1))
        self.assertEqual(next(i for i in r['items'] if i['term']=='ERP')['count'],1)
        self.assertEqual(next(i for i in r['items'] if i['term']=='ERP')['evidence'][0]['quote'],'负责ERP')
    def test_jd_extraction_and_recommendation_require_verbatim_evidence(self):
        j=self.call('upsert',job={'description':'负责需求分析。熟悉ERP。'})['job'];m=self.material()
        for task,result in [('extract',{'items':[{'text':'需要需求分析','quote':'负责需求分析','materialId':''}]}),('recommend',{'items':[{'text':'该经历与需求分析相关','quote':m['body'],'materialId':m['id']}]})]:
            d=self.generate(self.preview(task,jobId=j['id'],materialIds=[m['id']]),result);self.assertEqual(d['status'],'ready')
    def test_500_versions_and_readable_font_floor(self):
        base=self.state['versions'][0];self.state['versions']=[{**copy.deepcopy(base),'id':str(i)} for i in range(31)];validate_state(self.state)
        v=self.state['versions'][0];v['fontSize']=11;v['minFontSize']=10.5;v['summary']=[{'label':'合成说明','text':'需求分析与产品验收。'*600}]
        pdf,meta=render_pdf(self.state,v);self.assertGreaterEqual(meta['fontSize'],10.5);self.assertGreater(meta['pages'],1)
        v['minFontSize']=8
        with self.assertRaises(ValueError):validate_state(self.state)
    def test_provider_wire_formats_and_url_validation(self):
        for provider,preset in llm.PRESETS.items():
            c={**llm.DEFAULT,**{k:v for k,v in preset.items() if k!='label'},'model':'test','apiKey':'synthetic-secret','enabled':True}
            if provider=='custom':c['baseUrl']='https://models.example/v1'
            body=llm.request_body(c,'system','prompt');self.assertEqual(body['model'],'test')
            protocol=c['protocol'];answer={'responses':{'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'OK'}]}]},'messages':{'content':[{'type':'text','text':'OK'}],'stop_reason':'end_turn'},'chat':{'choices':[{'message':{'content':'OK'},'finish_reason':'stop'}]}}[protocol]
            with patch('urllib.request.build_opener') as opener:
                response=opener.return_value.open.return_value.__enter__.return_value;response.read.return_value=json.dumps(answer).encode()
                self.assertEqual(llm.call(c,body)[0],'OK');args=opener.return_value.open.call_args;self.assertEqual(args.kwargs['timeout'],45)
                request=args.args[0];self.assertEqual(json.loads(request.data),body);self.assertNotIn('synthetic-secret',request.data.decode())
        for url in ('http://public.example','https://user:pass@api.example','https://api.example?key=secret'):
            with self.assertRaises(ValueError):llm.validate({**llm.DEFAULT,'baseUrl':url})
        self.assertEqual(llm.validate({**llm.DEFAULT,'baseUrl':'http://127.0.0.1:1234/v1','allowLocal':True})['protocol'],'responses')

    def test_apply_journal_recovers_before_and_after_resume_commit(self):
        d=self.generate(self.preview(),{'text':'负责需求分析并整理3份验收记录。','evidence':[]})
        before=copy.deepcopy(self.state)
        value,txt=assistant.apply(self.store,{'id':d['id'],'verified':True},self.state)
        assistant.begin_apply(self.store,value,txt,before)
        assistant.recover_applies(self.store,before)
        self.assertEqual(self.call('assist-state')['aiDrafts'][0]['status'],'ready')
        assistant.begin_apply(self.store,d,txt,before)
        self.state['revision']+=1
        assistant.recover_applies(self.store,self.state)
        recovered=self.call('assist-state')['aiDrafts'][0]
        self.assertEqual(recovered['status'],'accepted');self.assertEqual(recovered['acceptedText'],txt)
        value,txt=assistant.apply(self.store,{'id':d['id']},self.state,True)
        assistant.begin_apply(self.store,value,txt,self.state,True)
        self.state['revision']+=1
        assistant.recover_applies(self.store,self.state)
        self.assertEqual(self.call('assist-state')['aiDrafts'][0]['status'],'undone')
    def test_malformed_draft_backup_rejected_without_data_loss(self):
        self.preview();backup=self.call('backup');before=self.call('assist-state')
        for bad_result in ({'text':[]},{'questions':[{}]},{'items':['invalid']},{'evidence':[{'quote':None}]}):
            bad=copy.deepcopy(backup);bad['aiDrafts'][0]['result']=bad_result
            with self.assertRaises(ValueError):self.call('import',backup=bad)
            self.assertEqual(before,self.call('assist-state'))

    def test_missing_target_and_nonlocal_no_key_rejected(self):
        with self.assertRaises(ValueError):assistant.prepare(self.store,{'task':'rewrite'},self.state)
        c={**llm.DEFAULT,'enabled':True,'model':'test','allowLocal':True,'apiKey':''}
        with patch('urllib.request.build_opener') as opener:
            with self.assertRaises(ValueError):llm.call(c,llm.request_body(c,'system','prompt'))
            opener.assert_not_called()
    def test_running_request_blocks_import_and_delete_and_restart_marks_failed(self):
        backup=self.call('backup');d=self.preview()
        with self.store._db() as db:
            stored=assistant.get(db,'ai_drafts',d['id']);stored['status']='running';assistant.put(db,'ai_drafts',stored)
        with self.assertRaises(ValueError):self.call('import',backup=backup)
        with self.assertRaises(ValueError):self.call('draft-delete',id=d['id'])
        assistant.recover_running(self.store)
        self.assertEqual(self.call('assist-state')['aiDrafts'][0]['status'],'failed')
