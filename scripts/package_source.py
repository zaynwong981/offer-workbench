"""Build a source-only release using an explicit allowlist, never the working tree."""
from pathlib import Path
import argparse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    # Public brand assets only; private campaigns are stored outside this repository.
    'docs/brand/GitHub展示横幅.png',
    'docs/brand/README.md',
    'docs/brand/github-banner.html',
    'docs/brand/logo-layout-check.json',
    'docs/brand/logo/avatar-512.png',
    'docs/brand/logo/avatar.svg',
    'docs/brand/logo/export.html',
    'docs/brand/logo/favicon.ico',
    'docs/brand/logo/icon-16.png',
    'docs/brand/logo/icon-24.png',
    'docs/brand/logo/icon-32.png',
    'docs/brand/logo/mark-black-512.png',
    'docs/brand/logo/mark-black.svg',
    'docs/brand/logo/mark-blue-1024.png',
    'docs/brand/logo/mark-blue-256.png',
    'docs/brand/logo/mark-blue-512.png',
    'docs/brand/logo/mark-blue-64.png',
    'docs/brand/logo/mark-blue.svg',
    'docs/brand/logo/mark-small.svg',
    'docs/brand/logo/mark-white-512.png',
    'docs/brand/logo/mark-white.svg',
    'docs/brand/logo/wordmark.png',
    'docs/brand/logo/wordmark.svg',
    'docs/brand/render-brand.mjs',
    'docs/brand/品牌预览.html',
    'docs/brand/品牌预览.png',

    'app/backend/preference_options.py', 'app/frontend/config/preference-options.json', 'docs/reference/BOSS_FILTER_SOURCES.md',
    'app/backend/workflow.py', 'app/frontend/js/job-workflow.js', 'app/frontend/js/job-rules.js', 'app/frontend/css/job-workflow.css', 'tests/test_workflow.py', 'tests/test_job_rules.js',
    'docs/design/USER_JOURNEY.md', 'docs/images/user-journey.svg', 'docs/images/user-journey.png',
    'app/frontend/js/workspace-layout.js',
    'docs/media/workflow-demo.gif', 'docs/media/workflow-demo.mp4',
    'server.py', 'app/__init__.py', 'app/backend/__init__.py', 'RELEASE.json',
    'app/frontend/js/site-info.js', 'docs/USER_GUIDE.md',
    'docs/images/calendar-demo.png', 'VERSION', 'PROJECT.md', 'AGENTS.md', 'app/backend/schedule.py', 'app/frontend/js/calendar-ui.js', 'app/frontend/css/calendar.css',
    'docs/ARCHITECTURE.md', 'docs/PRIVACY.md', 'docs/RELEASING.md', 'docs/DEMO.md', 'docs/VALIDATION.md',
    'scripts/privacy_check.py', 'scripts/snapshot.py', 'scripts/demo.py', 'tests/test_schedule.py', 'tests/test_release.py', '.github/workflows/release.yml',
    'app/frontend/js/doc-reader.js', 'app/frontend/css/doc-reader.css',
    'app/frontend/css/studio.css', 'app/frontend/js/ui.js', 'app/frontend/js/photo-crop.js', 'app/frontend/guide.html', 'app/frontend/js/boss-help.js', 'docs/design/DESIGN_PLAN.md', 'docs/qa/UI_UPGRADE_QA.md',
    'tests/test_photo_crop.js', 'tests/test_pdf_layout.py',
    'app/backend/server.py', 'app/backend/seed.py', 'app/backend/career.py', 'app/backend/boss_adapter.py', 'app/frontend/js/app.js', 'app/frontend/css/style.css', 'app/frontend/index.html',
    'app/frontend/js/career.js', 'app/frontend/css/career.css', 'app/frontend/career.html', 'app/frontend/js/salary-engine.js', 'app/frontend/js/salary-job.js', 'app/frontend/js/salary-ui.js', 'app/frontend/css/salary.css', 'app/frontend/config/salary-policies.json', 'docs/reference/SALARY_POLICY_SOURCES.md', 'README.md', 'LICENSE', 'SECURITY.md',
    'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'docs/qa/BROWSER_QA.md', 'requirements.txt', '.gitignore',
    'config.example.json', '打开简历工作台.command', '连接BOSS浏览器.command', 'start.bat',
    'app/frontend/vendor/pdfjs/pdf.mjs', 'app/frontend/vendor/pdfjs/pdf.worker.mjs', 'app/frontend/vendor/pdfjs/PDFjs-LICENSE',
    'scripts/package_source.py', 'tests/test_boss_adapter.py', 'tests/test_career.py',
    'tests/test_integration.py', 'tests/test_editor_state.js', 'tests/test_career_ui.js', 'tests/test_salary_engine.js', 'tests/test_salary_ui.js', 'tests/test_salary_job.js', '.github/workflows/test.yml',
]


def package(destination):
    missing = [name for name in FILES if not (ROOT / name).is_file()]
    if missing:
        raise ValueError('Missing source files: ' + ', '.join(missing))
    # Private paths must never enter even if the directory gains new files.
    for name in FILES:
        path = ROOT / name
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise ValueError('Refusing symlink or external source: ' + name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(ROOT / name, 'offer-workbench/' + name)
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / ('dist/offer-workbench-' + (ROOT / 'VERSION').read_text(encoding="utf-8").strip() + '-source.zip'))
    print(package(parser.parse_args().output))
