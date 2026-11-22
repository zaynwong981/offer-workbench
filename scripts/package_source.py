"""Build a source-only release using an explicit allowlist, never the working tree."""
from pathlib import Path
import argparse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'docs/images/calendar-demo.png', 'VERSION', 'PROJECT.md', 'AGENTS.md', 'schedule.py', 'calendar-ui.js', 'calendar.css',
    'docs/ARCHITECTURE.md', 'docs/PRIVACY.md', 'docs/RELEASING.md', 'docs/DEMO.md', 'docs/VALIDATION.md',
    'scripts/privacy_check.py', 'scripts/snapshot.py', 'scripts/demo.py', 'tests/test_schedule.py', 'tests/test_release.py', '.github/workflows/release.yml',
    'doc-reader.js', 'doc-reader.css',
    'studio.css', 'ui.js', 'photo-crop.js', 'boss-help.html', 'boss-help.js', 'DESIGN_PLAN.md', 'UI_UPGRADE_QA.md',
    'tests/test_photo_crop.js', 'tests/test_pdf_layout.py',
    'server.py', 'seed.py', 'career.py', 'boss_adapter.py', 'app.js', 'style.css', 'index.html',
    'career.js', 'career.css', 'career.html', 'salary-engine.js', 'salary-job.js', 'salary-ui.js', 'salary.css', 'salary-policies.json', 'SALARY_POLICY_SOURCES.md', 'README.md', 'LICENSE', 'SECURITY.md',
    'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'BROWSER_QA.md', 'requirements.txt', '.gitignore',
    'config.example.json', '打开简历工作台.command', '连接BOSS浏览器.command', 'start.bat',
    'assets/pdf.mjs', 'assets/pdf.worker.mjs', 'assets/PDFjs-LICENSE',
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
