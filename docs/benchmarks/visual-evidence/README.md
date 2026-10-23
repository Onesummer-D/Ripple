# Agent E · 视觉差异资源测试（2026-10-21）

此目录仅包含**合成资源测试**及门控回归诊断，不包含真实浏览器 Evidence。资源数据是 Node v22.16.0 / Linux x64 下的独立进程结果。`resource-stress-2026-10-21.log` 保留 `/usr/bin/time -v` 的原始 peak RSS 和耗时；`diagnostic-results.json` 是 24 个回归探针的原始结果。

**重要限制**：当前环境无法安装 `package-lock.json` 所固定的 npm 依赖。为使模块在离线环境中能够执行，性能探针和回归探针使用了放在 `node_modules` 中、**未入仓**的 `pixelmatch` 与 `pngjs` 诊断替身。资源门控与几何风险的运行路径得到了初步验证，但不能由此推断真实 pixelmatch 的吞吐量、抗锯齿行为或 pngjs 压缩耗时。官方 CI 和样例生成测试仍需在安装正式依赖后重跑。

基于 `scripts/benchmark-visual-evidence.mjs` 逐个运行：

```sh
/usr/bin/time -v node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/benchmark-visual-evidence.mjs large-many-regions
/usr/bin/time -v node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/benchmark-visual-evidence.mjs dense-near-cap
/usr/bin/time -v node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/benchmark-visual-evidence.mjs grid-limit
/usr/bin/time -v node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/benchmark-visual-evidence.mjs component-limit
/usr/bin/time -v node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/benchmark-visual-evidence.mjs header-limit
```

允许通过的场景只产生 `unknown`（客观像素变化），超限场景必须明确失败，且不产出视觉 RISK。该测试不修改 VerificationRunner、Receipt 或正式审批协议。
