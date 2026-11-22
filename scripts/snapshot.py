"""Snapshot/restore local data. Stop ALL workbench servers first. Never overwrite destinations."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot(data_dir, output, config=None):
    data_dir,output=Path(data_dir).resolve(),Path(output).resolve()
    if not data_dir.is_dir() or output.exists() or output.is_relative_to(data_dir):
        raise ValueError('数据目录必须存在，快照目录必须为数据目录外的新目录。')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temp:
        stage=Path(temp)/'snapshot';(stage/'data').mkdir(parents=True)
        for source in data_dir.rglob('*'):
            if source.is_symlink():raise ValueError('不备份符号链接。')
            if not source.is_file() or source.name.endswith(('-wal','-shm','-journal')):continue
            dest=stage/'data'/source.relative_to(data_dir);dest.parent.mkdir(parents=True, exist_ok=True)
            if source.suffix=='.sqlite3':
                src=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True);dst=sqlite3.connect(dest)
                try:src.backup(dst)
                finally:dst.close();src.close()
            else:shutil.copy2(source,dest)
        if config:
            config=Path(config)
            if config.is_symlink():raise ValueError('配置不能是符号链接。')
            shutil.copy2(config,stage/'config.local.json')
        manifest={'format':1,'createdAt':datetime.now(timezone.utc).isoformat(),'files':{str(p.relative_to(stage)).replace('\\','/'):digest(p) for p in stage.rglob('*') if p.is_file()}}
        (stage/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
        stage.rename(output)
    return output


def restore(snapshot_dir, destination):
    source,destination=Path(snapshot_dir).resolve(),Path(destination).resolve()
    if destination.exists() or destination.is_relative_to(source):raise ValueError('恢复目标必须是快照外的新目录，不能覆盖现有文件。')
    manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('format')!=1 or not isinstance(manifest.get('files'),dict):raise ValueError('快照格式错误。')
    for name,expected in manifest['files'].items():
        p=source/name
        if p.is_symlink() or not p.resolve().is_relative_to(source) or not p.is_file() or digest(p)!=expected:
            raise ValueError('快照校验失败；未恢复。')
    destination.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temp:
        stage=Path(temp)/'restored';stage.mkdir()
        for name in manifest['files']:
            p=stage/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/name,p)
        stage.rename(destination)
    return destination

if __name__=='__main__':
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
    b=sub.add_parser('backup');b.add_argument('--data-dir',required=True,type=Path);b.add_argument('--output',required=True,type=Path);b.add_argument('--config',type=Path);b.add_argument('--stopped',action='store_true',help='确认所有使用该数据的服务均已停止')
    r=sub.add_parser('restore');r.add_argument('--snapshot',required=True,type=Path);r.add_argument('--output',required=True,type=Path)
    args=p.parse_args()
    if args.command=='backup':
        if not args.stopped:p.error('请先停止所有工作台服务，再使用 --stopped；避免跨 JSON/SQLite 不一致。')
        print(snapshot(args.data_dir,args.output,args.config))
    else:print(restore(args.snapshot,args.output))
