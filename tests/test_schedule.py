import tempfile
import unittest
from app.backend.career import CareerStore
from app.backend.schedule import validate_event, conflicts, calendar_ics
from app.backend.seed import initial_state


def event(**kwargs):
    return validate_event(dict(title='示例科技面试', kind='interview', start='2026-12-01T14:00+08:00', end='2026-12-01T15:00+08:00', **kwargs))


class ScheduleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = CareerStore(self.tmp.name)
        self.resume = initial_state()

    def call(self, action, **payload):
        return self.store.dispatch('/api/career/' + action, payload, self.resume)

    def test_overlap_adjacent_deadline_and_date_only(self):
        a = event(id='a')
        b = {**a, 'id':'b', 'start':'2026-12-01T14:30+08:00', 'end':'2026-12-01T15:30+08:00'}
        adjacent = {**a, 'id':'c', 'start':a['end'], 'end':'2026-12-01T16:00+08:00'}
        self.assertEqual(len(conflicts([a,b])), 1)
        self.assertEqual(conflicts([a,adjacent]), [])
        point = {**a, 'id':'d', 'kind':'deadline', 'start':b['start'], 'end':''}
        self.assertEqual(conflicts([a,point])[0]['kind'], 'deadline')
        self.assertEqual(conflicts([a,{**point,'start':a['end']}]), [])
        self.assertEqual(conflicts([a,{**b,'allDay':True,'start':'2026-12-01','end':''}]), [])
        for status in ('done','cancelled'):
            self.assertEqual(conflicts([a,{**b,'status':status}]), [])

    def test_invalid_times_do_not_get_guessed(self):
        for changes in [{'start':'2026-02-30T14:00+08:00'}, {'end':''}, {'end':'2026-12-01T13:00+08:00'},
                        {'start':'2026-12-01T14:00Z'}, {'allDay':'false'}, {'kind':'unknown'}, {'revision':True}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_event({**event(),**changes})

    def test_crud_optimistic_conflict_and_independent_job_status(self):
        job=self.call('upsert',job={'title':'金融产品经理','company':'示例银行'})['job']
        e=event(jobId=job['id'])
        saved=self.call('event-save',event=e)['events'][0]
        self.assertEqual(saved['revision'],1)
        self.assertEqual(self.call('state')['jobs'][0]['status'],'saved')
        with self.assertRaises(ValueError):self.call('event-save',event=e)
        with self.assertRaises(ValueError):self.call('event-delete',event=e)
        changed=self.call('event-save',event={**saved,'status':'done'})['events'][0]
        self.assertEqual(changed['revision'],2)
        self.call('event-delete',event=changed)
        self.assertEqual(self.call('state')['events'],[])
        with self.assertRaises(ValueError):self.call('event-save',event=changed)

    def test_preview_is_read_only(self):
        e=self.call('event-save',event=event())['events'][0]
        result=self.call('event-check',event={**e,'id':'other','revision':0})
        self.assertEqual(len(result['conflicts']),1)
        self.assertEqual(len(self.call('state')['events']),1)

    def test_backup_roundtrip_atomic_validation_and_legacy(self):
        self.call('event-save',event=event())
        backup=self.call('backup')
        self.assertEqual(backup['schemaVersion'],2)
        with self.assertRaises(ValueError):self.call('import',backup={**backup,'events':[dict(backup['events'][0],jobId='missing')]})
        self.assertEqual(self.call('backup')['events'],backup['events'])
        self.call('import',backup=backup)
        self.assertEqual(self.call('state')['events'],backup['events'])
        with self.assertRaises(ValueError):self.call('import',backup={**backup,'events':backup['events']*2})
        self.call('import',backup={**backup,'schemaVersion':1,'events':[]})
        self.assertEqual(self.call('state')['events'],[])

    def test_delete_job_cascades_only_related_events(self):
        job=self.call('upsert',job={'title':'产品经理'})['job']
        self.call('event-save',event=event(jobId=job['id']))
        self.call('event-save',event=event())
        self.call('delete',id=job['id'])
        self.assertEqual(len(self.call('state')['events']),1)

    def test_ics_unicode_escape_line_folding_utc_and_stable_uid(self):
        e={**event(id='stable'),'title':'中文标题'*40,'notes':'行一\n行二,;\\'}
        ics=calendar_ics([e]).decode()
        self.assertIn('DTSTART:20261201T060000Z',ics)
        self.assertIn('UID:stable@offer-workbench.local',ics)
        self.assertTrue(all(len(line.encode())<=75 for line in ics.split('\r\n')))
        self.assertIn('行一\\n行二\\,\\;\\\\',ics.replace('\r\n ',''))
        dated=validate_event({**e,'allDay':True,'start':'2026-12-31','end':''})
        self.assertIn(b'DTEND;VALUE=DATE:20270101',calendar_ics([dated]))
        self.assertIn(b'TRANSP:TRANSPARENT',calendar_ics([dated]))
        self.assertNotIn(b'VALARM',calendar_ics([e]))


if __name__=='__main__':unittest.main()
