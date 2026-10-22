import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 路由变体双变体构建：dist-wide（基线）/ dist-tall（候选，共享媒体 wide→tall）。
 * 与 MPA 主 Lab 同一"唯一编辑点"模型。运行：node scripts/build-variants.mjs
 */
const variantDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(variantDir, '../../..')
// 直接以 node 调 vite 的 JS 入口（.bin shim 在中文路径 + cmd shell 下会编码错乱）
const viteEntry = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const sharedImage = path.join(variantDir, 'src', 'components', 'SharedFestivalImage.tsx')
const WIDE = '/media/qiguang-hero-wide.jpg'
const TALL = '/media/qiguang-hero-tall.jpg'

function runVite(args) {
  const result = spawnSync(process.execPath, [viteEntry, ...args], { cwd: variantDir, stdio: 'inherit', env: { ...process.env, NO_COLOR: '1' } })
  if (result.status !== 0) throw new Error(`vite ${args.join(' ')} 退出码 ${result.status ?? 'signal'}`)
}

const original = fs.readFileSync(sharedImage, 'utf8')
const pkgJsonPath = path.join(variantDir, 'package.json')
const pkgJsonBefore = fs.readFileSync(pkgJsonPath)
if (!original.includes(`src="${WIDE}"`)) throw new Error(`共享媒体未处于 wide 基线，拒绝构建变体`)
try {
  console.log('[router-variant] 构建基线 dist-wide …')
  runVite(['build', '--outDir', 'dist-wide', '--emptyOutDir'])
  fs.writeFileSync(sharedImage, original.replace(`src="${WIDE}"`, `src="${TALL}"`))
  console.log('[router-variant] 构建候选 dist-tall …')
  runVite(['build', '--outDir', 'dist-tall', '--emptyOutDir'])
} finally {
  fs.writeFileSync(sharedImage, original)
}
if (fs.readFileSync(sharedImage, 'utf8') !== original) throw new Error('共享媒体源文件还原失败')
// P2 加固：package.json 字节不变（构建不得改动依赖声明；仓库根 lock 由 CI git diff 兜底）
if (!fs.readFileSync(pkgJsonPath).equals(pkgJsonBefore)) throw new Error('package.json 在构建中被改动——依赖声明必须字节不变')
// P2 加固：双变体 dist 必须包含全部四张素材（public 目录完整复制核对）
const REQUIRED_MEDIA = ['qiguang-hero-wide.jpg', 'qiguang-hero-tall.jpg', 'qiguang-home-local.jpg', 'qiguang-archive.jpg']
for (const dist of ['dist-wide', 'dist-tall']) {
  for (const name of REQUIRED_MEDIA) {
    if (!fs.existsSync(path.join(variantDir, dist, 'media', name))) throw new Error(`构建产物缺少素材：${dist}/media/${name}`)
  }
}
console.log('[router-variant] 完成：dist-wide / dist-tall 就绪（各含 4 素材），源文件与 package.json 字节未变。')
console.log('[router-variant] 边界：本轮仅 SourceGraph 静态证明 + 双构建；MPA 主 Lab 的 24 张四视口截图为 MPA 浏览器证据，不归本变体。')
