"""Explicit, bounded model calls. Credentials never leave the private config file."""
import json
import os
import tempfile
import threading
import urllib.request
import urllib.error
from pathlib import Path
from urllib.parse import urlsplit

PRESETS = {
    'openai': {'label': 'OpenAI', 'baseUrl': 'https://api.openai.com/v1', 'protocol': 'responses'},
    'anthropic': {'label': 'Anthropic', 'baseUrl': 'https://api.anthropic.com/v1', 'protocol': 'messages'},
    'deepseek': {'label': 'DeepSeek', 'baseUrl': 'https://api.deepseek.com', 'protocol': 'chat'},
    'custom': {'label': '自定义兼容接口', 'baseUrl': '', 'protocol': 'chat'},
}
DEFAULT = dict(enabled=False, provider='openai', **{k:v for k,v in PRESETS['openai'].items() if k!='label'}, model='', maxOutputTokens=1500, dailyRequests=20, dailyTokens=100000, allowLocal=False, apiVersion='2023-06-01')
CONFIG_LOCK = threading.RLock()


def validate(raw):
    if not isinstance(raw, dict): raise ValueError('请检查 AI 配置格式。')
    result = {k:raw.get(k,v) for k,v in DEFAULT.items()}
    if result['provider'] not in PRESETS or result['protocol'] not in ('responses','messages','chat'): raise ValueError('请选择支持的接口协议。')
    for k in ('enabled','allowLocal'):
        if not isinstance(result[k],bool): raise ValueError('AI 开关格式不正确。')
    for k,lo,hi in [('maxOutputTokens',128,8000),('dailyRequests',1,200),('dailyTokens',1000,1000000)]:
        v=result[k]
        if isinstance(v,bool) or not isinstance(v,int) or not lo<=v<=hi: raise ValueError(f'{k}超出允许范围（{lo}–{hi}）。')
    for k in ('baseUrl','model','apiVersion'):
        v=result[k]
        if not isinstance(v,str) or len(v)>1000 or any(ord(c)<32 for c in v): raise ValueError('接口地址、模型或版本格式不正确。')
        result[k]=v.strip()
    if result['enabled'] and not result['model']: raise ValueError('请填写服务商为你的账号开放的模型 ID。')
    if result['baseUrl']:
        u=urlsplit(result['baseUrl'])
        local=u.hostname in ('localhost','127.0.0.1','::1')
        if not u.hostname or u.username or u.password or u.query or u.fragment or (u.scheme!='https' and not (u.scheme=='http' and local and result['allowLocal'])):
            raise ValueError('Base URL 使用 https，不含密钥、查询参数或账号；本机 http 接口需勾选允许本机服务。')
        result['baseUrl']=result['baseUrl'].rstrip('/')
    elif result['enabled']: raise ValueError('请填写 Base URL。')
    return result


class Config:
    def __init__(self, data_dir): self.path=Path(data_dir)/'.secrets'/'llm.json'
    def read(self):
        if self.path.is_symlink() or self.path.parent.is_symlink(): raise ValueError('AI 配置路径不能使用符号链接。')
        if not self.path.exists(): return {**DEFAULT,'apiKey':''}
        raw=json.loads(self.path.read_text(encoding='utf-8'))
        return {**validate(raw),'apiKey':raw.get('apiKey','')}
    def public(self):
        with CONFIG_LOCK:
            c=self.read();return {**{k:v for k,v in c.items() if k!='apiKey'},'hasKey':bool(c['apiKey']),'presets':PRESETS}
    def save(self, raw):
        with CONFIG_LOCK:
            c=validate(raw);old=self.read()
            key=raw.get('apiKey','')
            if not isinstance(key,str) or len(key)>2000 or any(ord(x)<32 for x in key): raise ValueError('密钥格式不正确。')
            changed=(c['provider'],c['baseUrl'])!=(old['provider'],old['baseUrl'])
            c['apiKey']='' if raw.get('clearKey') is True else key.strip() or ('' if changed else old['apiKey'])
            self.path.parent.mkdir(parents=True,exist_ok=True)
            if os.name!='nt': self.path.parent.chmod(0o700)
            fd,temp=tempfile.mkstemp(dir=self.path.parent)
            try:
                with os.fdopen(fd,'w',encoding='utf-8') as f: json.dump(c,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
                os.replace(temp,self.path)
            finally:
                if os.path.exists(temp): os.unlink(temp)
            return self.public()


def request_body(c, system, prompt, test=False):
    limit=128 if test else c['maxOutputTokens']
    common={'model':c['model']}
    if c['protocol']=='responses':
        return {**common,'instructions':system,'input':prompt,'max_output_tokens':limit,'store':False}
    if c['protocol']=='messages':
        return {**common,'system':system,'messages':[{'role':'user','content':prompt}],'max_tokens':limit}
    return {**common,'messages':[{'role':'system','content':system},{'role':'user','content':prompt}],'max_tokens':limit,'stream':False}


def endpoint(c): return c['baseUrl']+{'responses':'/responses','messages':'/messages','chat':'/chat/completions'}[c['protocol']]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None


def call(c, body):
    if not c['enabled'] or not c['model']: raise ValueError('AI 尚未启用或缺少模型 ID，请先保存配置。')
    if not c['apiKey'] and not (c['allowLocal'] and urlsplit(c['baseUrl']).hostname in ('localhost','127.0.0.1','::1')): raise ValueError('尚未保存密钥。请在 AI 设置中填写，或使用明确允许的本机接口。')
    headers={'Content-Type':'application/json','Accept':'application/json'}
    if c['protocol']=='messages': headers.update({'x-api-key':c['apiKey'],'anthropic-version':c['apiVersion']})
    elif c['apiKey']: headers['Authorization']='Bearer '+c['apiKey']
    request=urllib.request.Request(endpoint(c),data=json.dumps(body,ensure_ascii=False).encode(),headers=headers,method='POST')
    try:
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=45) as response:
            raw=response.read(2_000_001)
        if len(raw)>2_000_000: raise ValueError('模型返回内容过大，请缩小材料范围。')
        data=json.loads(raw)
    except urllib.error.HTTPError as exc:
        messages={401:'密钥或权限未通过，请核对配置。',403:'服务商拒绝访问，请核对账号权限和可用地区。',429:'服务商额度不足或限流，请稍后自行重试。'}
        raise ValueError(messages.get(exc.code, f'接口返回 HTTP {exc.code}；未自动重试，请检查 Base URL、协议和模型。')) from None
    except (urllib.error.URLError,TimeoutError,OSError): raise ValueError('连接超时或网络不可用；草稿已保留，未自动重试。') from None
    except (ValueError,TypeError): raise ValueError('接口未返回可读取的 JSON，请核对协议。') from None
    try:
        if c['protocol']=='responses':
            if data.get('status') not in (None,'completed'): raise ValueError()
            content='\n'.join(x['text'] for item in data['output'] if item.get('type')=='message' for x in item.get('content',[]) if x.get('type')=='output_text')
        elif c['protocol']=='messages':
            if data.get('stop_reason') not in (None,'end_turn','stop_sequence'): raise ValueError()
            content='\n'.join(x['text'] for x in data['content'] if x.get('type')=='text')
        else:
            choice=data['choices'][0]
            if choice.get('finish_reason') not in (None,'stop'): raise ValueError()
            content=choice['message']['content']
        if not isinstance(content,str) or not content.strip() or len(content)>50000: raise ValueError()
        return content, data.get('usage',{})
    except (KeyError,IndexError,TypeError,ValueError): raise ValueError('模型输出为空、被截断或结构不兼容；草稿已保留，请调整输出上限或模型。') from None
