"""Local recruiting events. Explicit UTC+08:00; a deadline is a point, not busy time."""
from datetime import date, datetime, timedelta, timezone
import re
import uuid

ZONE = timezone(timedelta(hours=8))
KINDS = {'interview': '面试', 'test': '笔试', 'deadline': '截止时间', 'followup': '跟进', 'offer': 'Offer 回复', 'onboarding': '入职'}
STATES = {'planned', 'done', 'cancelled'}


def validate_event(raw):
    if not isinstance(raw, dict):
        raise ValueError('日程格式不正确。')
    event = {}
    for key, limit in {'id': 80, 'jobId': 720, 'title': 200, 'kind': 30, 'status': 20,
                       'start': 40, 'end': 40, 'location': 1000, 'notes': 6000}.items():
        value = raw.get(key, 'planned' if key == 'status' else '')
        if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 and c not in '\n\t' for c in value):
            raise ValueError(f'{key} 格式不正确或内容过长。')
        event[key] = value.strip()
    event['allDay'] = raw.get('allDay', False)
    event['revision'] = raw.get('revision', 0)
    if type(event['allDay']) is not bool or type(event['revision']) is not int or event['revision'] < 0:
        raise ValueError('日程版本或日期类型不正确。')
    if not event['title'] or event['kind'] not in KINDS or event['status'] not in STATES:
        raise ValueError('请填写标题并选择有效的类型和状态。')
    if event['id'] and not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', event['id']):
        raise ValueError('日程编号不正确。')
    event['id'] = event['id'] or uuid.uuid4().hex
    try:
        if event['allDay']:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', event['start']) or event['end']:
                raise ValueError()
            date.fromisoformat(event['start'])
        else:
            for key in ('start', 'end'):
                if key == 'end' and not event[key]:
                    continue
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\+08:00', event[key]):
                    raise ValueError()
                datetime.fromisoformat(event[key])
            if not event['start']:
                raise ValueError()
            if event['kind'] in ('deadline', 'offer'):
                if event['end']:
                    raise ValueError()
            elif not event['end'] or event['end'] <= event['start']:
                raise ValueError()
    except (ValueError, OverflowError) as error:
        raise ValueError('请填写有效日期；定时活动需结束晚于开始，DDL 仅填截止时刻。时间按北京时间（UTC+08:00）。') from error
    return event


def conflicts(events):
    active = sorted((e for e in events if e['status'] == 'planned' and not e['allDay']), key=lambda e: e['start'])
    pairs = []
    # Only overlapping ranges or a point within a range. Adjacent appointments do not clash.
    for i, a in enumerate(active):
        for b in active[i+1:]:
            if b['start'] > (a['end'] or a['start']):
                break
            if a['end'] and b['end']:
                hit = a['start'] < b['end'] and b['start'] < a['end']
                kind = 'overlap'
            elif a['end'] or b['end']:
                span, point = (a, b) if a['end'] else (b, a)
                hit = span['start'] <= point['start'] < span['end']
                kind = 'deadline'
            else:
                hit = False
            if hit:
                pairs.append({'ids': [a['id'], b['id']], 'kind': kind,
                              'message': ('时间重叠' if kind == 'overlap' else '截止时间落在活动中') + '：' + a['title'] + ' / ' + b['title']})
    return pairs


def calendar_ics(events):
    def text(value):
        return value.replace('\\', '\\\\').replace('\r', '').replace('\n', '\\n').replace(';', '\\;').replace(',', '\\,')
    def utc(value):
        return datetime.fromisoformat(value).astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OfferWorkbench//Local Calendar//ZH', 'CALSCALE:GREGORIAN']
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    for e in events:
        lines += ['BEGIN:VEVENT', 'UID:' + e['id'] + '@offer-workbench.local', 'DTSTAMP:' + stamp,
                  'SEQUENCE:' + str(e['revision']), 'SUMMARY:' + text(e['title']),
                  'DESCRIPTION:' + text(KINDS[e['kind']] + '｜' + ('仅知日期，具体时刻待确认' if e['allDay'] else '北京时间 UTC+08:00') + '\n' + e['notes']),
                  'LOCATION:' + text(e['location']),
                  'STATUS:' + ('CANCELLED' if e['status'] == 'cancelled' else 'CONFIRMED'),
                  'TRANSP:' + ('TRANSPARENT' if e['allDay'] or not e['end'] or e['status'] != 'planned' else 'OPAQUE')]
        if e['allDay']:
            day = date.fromisoformat(e['start'])
            lines += ['DTSTART;VALUE=DATE:' + day.strftime('%Y%m%d'), 'DTEND;VALUE=DATE:' + (day + timedelta(days=1)).strftime('%Y%m%d')]
        else:
            lines += ['DTSTART:' + utc(e['start'])]
            if e['end']:
                lines += ['DTEND:' + utc(e['end'])]
        lines += ['END:VEVENT']
    lines += ['END:VCALENDAR']
    # RFC 5545 folding at <=75 octets without splitting UTF-8 characters.
    folded = []
    for line in lines:
        part = ''
        for char in line:
            if len((part + char).encode()) > 75:
                folded.append(part)
                part = ' '
            part += char
        folded.append(part)
    return ('\r\n'.join(folded) + '\r\n').encode()
