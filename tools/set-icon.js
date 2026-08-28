const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const rcedit = path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');

// Convert WSL paths to Windows paths for PowerShell
function toWin(p) {
  const abs = path.resolve(p);
  return abs.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');
}

const exe = toWin(path.join(root, 'release', 'win-unpacked', '项目管理系统.exe'));
const ico = toWin(path.join(root, 'build', 'icon.ico'));
const rc = toWin(rcedit);

const ps = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const cmd = `${ps} -Command "& '${rc}' '${exe}' --set-icon '${ico}'"`;

try {
  execSync(cmd, { stdio: 'pipe' });
  console.log(`✅ 图标已嵌入: ${exe}`);
} catch (e) {
  console.error(`❌ rcedit 失败: ${e.message}`);
  process.exit(1);
}
