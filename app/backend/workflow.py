"""Local job decisions, search plans and immutable application artifacts. No network."""
import base64
import copy
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

DECISIONS = {'open': '继续了解', 'later': '稍后考虑', 'skip': '不考虑'}
CHANNELS = ('BOSS', '公司官网', '邮件', '内推', '其他')
MAX_ARCHIVE = 40 * 1024 * 1024

def text(v, label, limit=2000):
    if not isinstance(v, str) or len(v) > limit or '\x00' in v:
        raise ValueError(f'{label}格式不正确或内容过长，请检查后再保存。')
    return v.strip()

def timestamp(v):
    v = text(v, '时间', 80)
    try:
        dt = datetime.fromisoformat(v.replace('Z', '+00:00'))
        if dt.tzinfo is None: raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('请填写含时区的具体时间。')
    return dt.isoformat(timespec='seconds')

def url(v):
    v = text(v, '链接', 3000)
    if not v: return ''
    u = urlsplit(v)
    if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or any(ord(c)<32 for c in v):
        raise ValueError('请使用不含账号密码的 http 或 https 链接。')
    return v

def rules(value):
    from .career import validate_preferences
    if not isinstance(value, dict): raise ValueError('筛选条件格式不正确。')
    result = {}
    for group in ('hard', 'preferred', 'explore'):
        raw = value.get(group, {})
        if not isinstance(raw, dict): raise ValueError('筛选条件格式不正确。')
        p = validate_preferences(raw)
        result[group] = {k:p[k] for k in ('cities','roles','keywords','salaryMin','salaryMax','excludedCompanies')}
    return result

def plan(value):
    if not isinstance(value, dict): raise ValueError('筛选方案格式不正确。')
    ident = text(value.get('id','') or uuid.uuid4().hex, '方案编号', 80)
    name = text(value.get('name',''), '方案名称', 100)
    if not name: raise ValueError('给方案起个名称，方便下次找到。')
    raw = value.get('filters', {})
    if not isinstance(raw, dict): raise ValueError('搜索条件格式不正确。')
    filters={}
    for key in ('keyword','city','salary','experience','education'):
        if key in raw: filters[key]=text(raw[key],key,100)
    page=raw.get('page',1)
    if isinstance(page,bool) or not isinstance(page,int) or not 1<=page<=5: raise ValueError('页码应为1至5。')
    filters['page']=page
    for key in ('scale','stage','jobType'):
        if key in raw:
            if not isinstance(raw[key],list) or len(raw[key])>30: raise ValueError('搜索多选条件过多。')
            filters[key]=[text(x,key,100) for x in raw[key]]
    return {'id':ident,'name':name,'filters':filters,'rules':rules(value.get('rules',{}))}

def setup(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, data TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, artifact_id TEXT NOT NULL, data TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id), FOREIGN KEY(artifact_id) REFERENCES artifacts(id));
    ''')

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def artifact_summary(a):
    return {k:a[k] for k in ('id','jobId','versionId','versionName','exportedAt','filename','pdfSha256','snapshotSha256','pages')}

def extra_state(db, full=False):
    row=db.execute("SELECT value FROM settings WHERE key='searchPlans'").fetchone()
    artifacts=[json.loads(x[0]) for x in db.execute('SELECT data FROM artifacts ORDER BY rowid DESC')]
    submissions=[json.loads(x[0]) for x in db.execute('SELECT data FROM submissions ORDER BY rowid DESC')]
    return {'searchPlans':json.loads(row[0]) if row else [],'artifacts':artifacts if full else [artifact_summary(a) for a in artifacts], 'submissions':submissions}

def record_artifact(store, job, state, version, pdf, filename, pages):
    if len(pdf)>5*1024*1024: raise ValueError('这份PDF超过5MB，暂不能留档。请缩小照片后重新导出。')
    # Capture only the chosen version plus the shared profile/education used to render it.
    snapshot=copy.deepcopy({k:state[k] for k in ('schemaVersion','profile','educationTitle','education') if k in state})
    snapshot.update({'versions':[copy.deepcopy(version)],'revision':state.get('revision',0)})
    a={'id':uuid.uuid4().hex,'jobId':job['id'],'versionId':version['id'],'versionName':version.get('name',''),
       'exportedAt':datetime.now(timezone.utc).isoformat(timespec='seconds'),'filename':filename,'pages':pages,
       'pdfBase64':base64.b64encode(pdf).decode(),'pdfSha256':hashlib.sha256(pdf).hexdigest(),
       'resumeSnapshot':snapshot,'jobSnapshot':{k:v for k,v in job.items() if k not in ('history','historyTotal','preparation')}}
    a['snapshotSha256']=digest({'resume':a['resumeSnapshot'],'job':a['jobSnapshot']})
    encoded=json.dumps(a,ensure_ascii=False)
    with store._db() as db:
        size=db.execute('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) FROM artifacts').fetchone()[0]
        if size+len(encoded.encode())>MAX_ARCHIVE: raise ValueError('PDF留档已达到40MB。请先保存完整备份。可删除无需保留且未确认投递的机会；已确认机会的留档不能清除。')
        db.execute('INSERT INTO artifacts VALUES (?,?,?)',(a['id'],job['id'],encoded))
    return artifact_summary(a)

def validate_extra_backup(backup, job_ids):
    plans=backup.get('searchPlans',[]); arts=backup.get('artifacts',[]); subs=backup.get('submissions',[])
    if not all(isinstance(x,list) for x in (plans,arts,subs)) or len(plans)>50 or len(arts)>5000 or len(subs)>5000:
        raise ValueError('筛选方案或投递留档列表格式不正确。')
    plans=[plan(x) for x in plans]
    if len({x['id'] for x in plans})!=len(plans): raise ValueError('筛选方案编号重复。')
    ids=set();clean_arts=[];size=0
    for raw in arts:
        if not isinstance(raw,dict): raise ValueError('PDF留档格式不正确。')
        a=copy.deepcopy(raw)
        for key in ('id','jobId','versionId','versionName','filename','pdfSha256','snapshotSha256'):
            a[key]=text(a.get(key),key,720)
        a['exportedAt']=timestamp(a.get('exportedAt'))
        if not a['id'] or a['id'] in ids or a['jobId'] not in job_ids: raise ValueError('PDF留档编号重复或关联岗位缺失。')
        try: pdf=base64.b64decode(a.get('pdfBase64',''),validate=True)
        except Exception: raise ValueError('PDF留档内容损坏。')
        if not pdf.startswith(b'%PDF') or len(pdf)>5*1024*1024 or hashlib.sha256(pdf).hexdigest()!=a['pdfSha256']: raise ValueError('PDF留档校验失败，未导入任何记录。')
        if not isinstance(a.get('resumeSnapshot'),dict) or not isinstance(a.get('jobSnapshot'),dict): raise ValueError('简历或岗位快照缺失。')
        from .server import validate_state
        snapshot=a['resumeSnapshot']
        # Use a copy; validation must not rewrite immutable imported snapshots.
        validate_state(copy.deepcopy(snapshot))
        if len(snapshot['versions'])!=1 or snapshot['versions'][0]['id']!=a['versionId'] or a['jobSnapshot'].get('id')!=a['jobId']: raise ValueError('留档关联内容不一致。')
        if digest({'resume':snapshot,'job':a['jobSnapshot']})!=a['snapshotSha256']: raise ValueError('简历快照校验失败，未导入任何记录。')
        if isinstance(a.get('pages'),bool) or not isinstance(a.get('pages'),int) or not 1<=a['pages']<=1000: raise ValueError('PDF页数无效。')
        size+=len(json.dumps(a,ensure_ascii=False).encode());ids.add(a['id']);clean_arts.append(a)
    if size>MAX_ARCHIVE: raise ValueError('备份中的PDF留档超过40MB。')
    seen=set();clean_subs=[];by_id={a['id']:a for a in clean_arts}
    for raw in subs:
        if not isinstance(raw,dict): raise ValueError('投递记录格式不正确。')
        s={key:text(raw.get(key),key,2000 if key=='notes' else 720) for key in ('id','jobId','artifactId','channel','notes')}
        for key in ('submittedAt','recordedAt'): s[key]=timestamp(raw.get(key))
        a=by_id.get(s['artifactId'])
        if not s['id'] or s['id'] in seen or not a or a['jobId']!=s['jobId'] or s['channel'] not in CHANNELS: raise ValueError('投递记录编号、渠道或PDF关联不正确。')
        seen.add(s['id']);clean_subs.append(s)
    return plans,clean_arts,clean_subs

def restore_extra(db, values):
    plans,arts,subs=values
    db.execute("INSERT INTO settings VALUES ('searchPlans',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps(plans,ensure_ascii=False),))
    for a in arts: db.execute('INSERT INTO artifacts VALUES (?,?,?)',(a['id'],a['jobId'],json.dumps(a,ensure_ascii=False)))
    for s in subs: db.execute('INSERT INTO submissions VALUES (?,?,?,?)',(s['id'],s['jobId'],s['artifactId'],json.dumps(s,ensure_ascii=False)))

def dispatch(store,db,action,payload,state):
    if action in ('plan-save','plan-delete'):
        plans=extra_state(db)['searchPlans']
        if action=='plan-save':
            value=plan(payload.get('plan'));plans=[p for p in plans if p['id']!=value['id']]+[value]
            if len(plans)>50: raise ValueError('最多保存50个筛选方案，请先删除不再使用的方案。')
        else:
            ident=text(payload.get('id'),'方案编号',80);plans=[p for p in plans if p['id']!=ident]
        db.execute("INSERT INTO settings VALUES ('searchPlans',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps(plans,ensure_ascii=False),))
        return {'searchPlans':plans}
    if action=='artifact':
        row=db.execute('SELECT data FROM artifacts WHERE id=?',(text(payload.get('id'),'留档编号',80),)).fetchone()
        if not row: raise ValueError('未找到这份PDF留档，请确认备份是否完整恢复。')
        return json.loads(row[0])
    if action=='submission-confirm':
        if payload.get('confirmed') is not True: raise ValueError('请先确认已在原渠道完成提交。')
        ident=text(payload.get('requestId'),'确认编号',80)
        if not re.fullmatch(r'[a-zA-Z0-9_-]{12,80}',ident): raise ValueError('确认编号无效，请重新打开投递记录。')
        job=store._get_job(db,text(payload.get('jobId'),'岗位编号',720))
        row=db.execute('SELECT data FROM artifacts WHERE id=?',(text(payload.get('artifactId'),'PDF编号',80),)).fetchone()
        if not row: raise ValueError('请先在这个岗位导出PDF，再选择实际提交的那一份。')
        a=json.loads(row[0]);channel=text(payload.get('channel'),'投递渠道',80)
        if a['jobId']!=job['id'] or channel not in CHANNELS: raise ValueError('请核对投递渠道与该岗位的PDF。')
        submitted=timestamp(payload.get('submittedAt'))
        if datetime.fromisoformat(submitted)>datetime.now(timezone.utc): raise ValueError('投递时间不能在未来。尚未提交时，可先安排跟进日程。')
        s={'id':ident,'jobId':job['id'],'artifactId':a['id'],'channel':channel,'submittedAt':submitted,'notes':text(payload.get('notes',''),'投递备注',2000),'recordedAt':datetime.now(timezone.utc).isoformat(timespec='seconds')}
        prior=db.execute('SELECT data FROM submissions WHERE id=?',(ident,)).fetchone()
        if prior:
            prior=json.loads(prior[0])
            if any(prior[k]!=s[k] for k in s if k!='recordedAt'): raise ValueError('该确认已保存，不能用同一编号改写投递记录。')
            return {'submission':prior}
        db.execute('INSERT INTO submissions VALUES (?,?,?,?)',(ident,job['id'],a['id'],json.dumps(s,ensure_ascii=False)))
        # A historical application record must not rewind a later interview/offer outcome.
        if job['status'] in ('saved','contacted'): job['status']='applied'
        job.pop('history',None);job.pop('historyTotal',None);job['updatedAt']=s['recordedAt']
        db.execute('UPDATE jobs SET data=?,updated_at=? WHERE id=?',(json.dumps(job,ensure_ascii=False),job['updatedAt'],job['id']))
        store._activity(db,job['id'],'submission',f"本人确认已提交 · {channel} · {a['versionName']}")
        return {'submission':s}
    if action in ('view','decision','preparation'):
        job=store._get_job(db,text(payload.get('id'),'岗位编号',720));now=datetime.now(timezone.utc).isoformat(timespec='seconds')
        if action=='view':
            job['firstViewedAt']=job.get('firstViewedAt') or now;job['lastViewedAt']=now
        elif action=='decision':
            decision=payload.get('decision')
            if decision not in DECISIONS: raise ValueError('请选择继续了解、稍后考虑或不考虑。')
            job['decision']=decision;job['decisionReason']=text(payload.get('reason',''),'取舍原因',2000);job['decidedAt']=now
            store._activity(db,job['id'],'decision',DECISIONS[decision]+('：'+job['decisionReason'] if job['decisionReason'] else ''))
        else:
            raw=payload.get('preparation')
            if not isinstance(raw,dict): raise ValueError('准备内容格式不正确。')
            links=raw.get('works',[])
            if not isinstance(links,list) or len(links)>20 or any(not isinstance(x,dict) for x in links): raise ValueError('最多保存20个作品链接。')
            job['preparation']={'greeting':text(raw.get('greeting',''),'沟通文字',10000),'works':[{'label':text(x.get('label',''),'作品名称',100),'url':url(x.get('url',''))} for x in links if isinstance(x,dict)],'submitUrl':url(raw.get('submitUrl',''))}
            store._activity(db,job['id'],'preparation','保存沟通文字、作品与提交入口')
        job.pop('history',None);job.pop('historyTotal',None)
        db.execute('UPDATE jobs SET data=? WHERE id=?',(json.dumps(job,ensure_ascii=False),job['id']))
        return {'job':store._get_job(db,job['id'])}
    raise ValueError('未知的岗位准备操作。')
