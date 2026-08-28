// 将 Monaco 编辑器资源内置到渲染层 assets（electron-builder 会剥离 node_modules 中的 devDependencies，
// 打包版无法从 node_modules 加载，故构建前同步到 src/renderer/assets/monaco/vs）
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const dest = path.join(root, 'src', 'renderer', 'assets', 'monaco', 'vs');

if (!fs.existsSync(path.join(src, 'loader.js'))) {
  console.error('[sync-monaco] node_modules/monaco-editor/min/vs/loader.js 不存在，请先 npm install');
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true });
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(d, e.name));
    else files.push(e.name);
  }
})(dest);
console.log(`[sync-monaco] ${files.length} 个文件 → src/renderer/assets/monaco/vs`);
