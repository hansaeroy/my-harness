import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
try {
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
  if (path.resolve(gitRoot) !== root) throw new Error(`현재 작업 폴더가 Git 루트가 아닙니다: ${gitRoot}`);
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'inherit' });
  process.stdout.write('Git hook 경로를 .githooks로 설정했습니다.\n');
} catch (error) {
  process.stderr.write(`Git hook 설치 실패: ${error.message}\n`);
  process.exitCode = 1;
}
