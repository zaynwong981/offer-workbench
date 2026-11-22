"""Release allowlist and privacy gate. Reports file/rule only, never matching secrets."""
from pathlib import Path
import re
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from package_source import FILES, ROOT


def check(root=ROOT, tracked=True):
    failures=[]
    names=set(FILES)
    if tracked and (root/'.git').exists():
        p=subprocess.run(['git','-C',str(root),'ls-files','-z'],check=True,capture_output=True)
        for name in p.stdout.decode().split('\0'):
            if name and name not in names:failures.append((name,'outside release allowlist'))
    rules={
        'private home path': rb'/(?:Users|home)/[A-Za-z0-9_.-]+/',
        'Windows personal path': rb'[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\',
        'private Feishu document': rb'https://[a-zA-Z0-9-]+\.feishu\.cn/(?:docx|wiki|sheets)/[A-Za-z0-9]+',
        'private key': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        'API credential': rb'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,})',
        'mainland phone': rb'(?<![\d.])1[3-9][0-9]{9}(?![\d.])',
    }
    for name in sorted(names):
        path=root/name
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            failures.append((name,'missing or unsafe path'));continue
        if any(part in {'data','exports','dist','.taste-skill','backups','local'} for part in Path(name).parts) or name.endswith(('.pdf','.db','.sqlite3','.log')):
            failures.append((name,'private runtime file'))
        data=path.read_bytes()
        # Vendored PDF.js is audited upstream source; numeric minified tables are not contacts.
        for rule,pattern in rules.items():
            if name.startswith('app/frontend/vendor/') and rule=='mainland phone':continue
            if re.search(pattern,data):failures.append((name,rule))
    return failures

if __name__=='__main__':
    found=check()
    for file,rule in found:print(f'FAIL {file}: {rule}')
    if found:raise SystemExit(1)
    print(f'PASS privacy gate: {len(FILES)} allowlisted source files; no runtime data')
