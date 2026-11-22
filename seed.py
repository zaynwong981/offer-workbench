"""Anonymous starter content. Personal resumes belong only in the data directory."""

def initial_state():
    versions = []
    for key, name in [('saas', 'SaaS产品经理'), ('ai', 'AI应用产品经理'), ('finance', '金融产品经理')]:
        versions.append({
            'id': key, 'name': name, 'target': name, 'showTarget': True,
            'summaryTitle': '个人优势', 'workTitle': '工作与项目经历',
            'summary': [{'label': '能力与实践', 'text': '请填写可以通过作品、面试或背调验证的经历。'}],
            'experience': [], 'fontSize': 10.5, 'autoFit': True,
        })
    return {
        'schemaVersion': 1, 'revision': 0,
        'profile': {'name': '你的姓名', 'englishName': '', 'phone': '', 'email': '',
                    'birth': '', 'gender': '', 'location': '', 'showLocation': True,
                    'showPhoto': False, 'photo': ''},
        'educationTitle': '教育经历', 'education': [], 'versions': versions,
    }
