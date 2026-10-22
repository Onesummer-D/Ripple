import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 构建基线（dist-wide）与候选（dist-tall）两个变体。
 * 候选变体 = 共享媒体唯一编辑点 wide→tall（模拟横版→竖版替换意图），
 * 其余源码与 public/ 资产字节完全一致；构建完成后强制还原源文件。
 * 依赖解析自仓库根 node_modules，本目录不跑 npm ci。
 *
 * 运行（仓库根或本目录均可）：node test/qiguang-lab/scripts/build-variants.mjs
 */
const labDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(labDir, '../..')
const viteBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
const sharedImage = path.join(labDir, 'src', 'components', 'SharedFestivalImage.tsx')

const WIDE = '/media/qiguang-hero-wide.jpg'
const TALL = '/media/qiguang-hero-tall.jpg'

function runVite(args) {
  const result = spawnSync(viteBin, args, {
    cwd: labDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, NO_COLOR: '1' },
  })
  if (result.status !== 0) throw new Error(`vite ${args.join(' ')} 退出码 ${result.status ?? 'signal'}`)
}

const original = fs.readFileSync(sharedImage, 'utf8')
if (!original.includes(`src="${WIDE}"`)) {
  throw new Error(`共享媒体 src 未处于 wide 基线（${WIDE}），拒绝构建变体——请先还原 ${path.relative(repoRoot, sharedImage)}`)
}

try {
  console.log('[build-variants] 1/3 构建基线 dist-wide …')
  runVite(['build', '--outDir', 'dist-wide', '--emptyOutDir'])

  console.log(`[build-variants] 2/3 临时替换共享媒体 ${WIDE} → ${TALL} …`)
  fs.writeFileSync(sharedImage, original.replace(`src="${WIDE}"`, `src="${TALL}"`))
  runVite(['build', '--outDir', 'dist-tall', '--emptyOutDir'])
  console.log('[build-variants] 3/3 候选 dist-tall 构建完成，还原源文件 …')
} finally {
  fs.writeFileSync(sharedImage, original)
}

if (fs.readFileSync(sharedImage, 'utf8') !== original) {
  throw new Error('共享媒体源文件还原失败——工作区被污染，请人工检查')
}
console.log('[build-variants] 完成：dist-wide / dist-tall 就绪，SharedFestivalImage.tsx 已字节还原。')
