"""Structured analysis with retained evidence, separate from its compact UI."""
from .workflow import text

CATEGORIES = ('学历', '专业', '经验', '能力', '工具', '业务', '职责', '其他')
EXTRACT_SCHEMA = '{"groups":[{"category":"学历/专业/经验/能力/工具/业务/职责/其他","tags":[{"label":"简短关键词，保留必要/优先等限定","quote":"岗位中的连续原句"}]}],"profile":{"text":"依据明确要求概括的候选人画像","quotes":["支持画像的岗位原句"]}}'
EXPLORE_SCHEMA = '{"directions":[{"industry":"建议行业","role":"建议岗位方向","keywords":["招聘平台常用的岗位搜索词"],"reason":"匹配原因与需要补齐的能力，不复述全文","quote":"简历中的连续原句"}]}'


def required(value, label, limit):
    result = text(value, label, limit)
    if not result:
        raise ValueError(label + '不能为空。')
    return result


def array(value, label, minimum, maximum):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ValueError(label + '数量或格式不正确。')
    return value


def quote(value, source):
    result = required(value, '依据原句', 2000)
    if result not in source:
        raise ValueError('分析依据无法在所选原文中找到，结果已保留，未自动采用。')
    return result


def validate(result, task, source):
    if not isinstance(result, dict):
        raise ValueError('分析结果结构不正确。')
    if task == 'extract':
        buckets = {}
        for group in array(result.get('groups'), '关键词分类', 1, 8):
            if not isinstance(group, dict) or group.get('category') not in CATEGORIES:
                raise ValueError('关键词分类不正确。')
            bucket = buckets.setdefault(group['category'], [])
            for item in array(group.get('tags'), '分类关键词', 0, 120):
                if not isinstance(item, dict):
                    raise ValueError('关键词格式不正确。')
                tag = {'label': required(item.get('label'), '关键词', 80),
                       'quote': quote(item.get('quote'), source)}
                if not any(t['label'] == tag['label'] for t in bucket):
                    bucket.append(tag)
        if not any(buckets.values()):
            raise ValueError('没有提取到有效关键词，请补充岗位职责或任职要求后再分析。')
        if sum(map(len, buckets.values())) > 120:
            raise ValueError('关键词过多，请缩小岗位正文范围。')
        profile = result.get('profile')
        if not isinstance(profile, dict):
            raise ValueError('候选人画像格式不正确。')
        return {'groups': [{'category': k, 'tags': buckets[k]} for k in CATEGORIES if buckets.get(k)],
                'profile': {'text': required(profile.get('text'), '候选人画像', 2000),
                            'quotes': [quote(q, source) for q in array(profile.get('quotes'), '画像依据', 1, 8)]}}
    if task == 'explore':
        directions = []
        for item in array(result.get('directions'), '探索方向', 1, 8):
            if not isinstance(item, dict):
                raise ValueError('探索方向格式不正确。')
            keywords = list(dict.fromkeys(required(k, '岗位搜索词', 100) for k in
                                         array(item.get('keywords'), '岗位搜索词', 1, 8)))
            directions.append({'industry': required(item.get('industry'), '行业', 100),
                               'role': required(item.get('role'), '岗位方向', 100),
                               'keywords': keywords,
                               'reason': required(item.get('reason'), '建议原因', 2000),
                               'quote': quote(item.get('quote'), source)})
        return {'directions': directions}
    raise ValueError('不支持的分析任务。')
