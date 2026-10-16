# Lovable × Bolt 源码复核记录与 Ripple 设计输入

**日期：2026-10-16**  
**性质：竞品调研补充材料；只读源码审计**  
**核验对象：**
- Lovable：[`Onesummer-D/mountain-spirit-showcase`](https://github.com/Onesummer-D/mountain-spirit-showcase)（私有仓库，`main`）
- Bolt：[`Onesummer-D/ripple-qingye-bolt`](https://github.com/Onesummer-D/ripple-qingye-bolt)（私有仓库，`main`）

> **证据分类**：本文将「Git 可复核源码及提交差异」「用户实验截图与人工验收」「Agent 过程自述」分别处理。读取 Git 不等于重新执行应用，不将代码中存在测试脚本等同于本次重新跑过测试，也不将 Git 提交历史等同于截图已绑定具体版本。

## 一、历史版本与三个实验

Lovable 仓库具有 24 条可检索提交（包含初始化、过程 `Changes` 提交、实验结果及后续 README 提交）；有若干合并提交，不应将这些提交机械解释为 24 次独立用户操作。以下使用阶段完成时的提交 SHA 作为可复核快照：

| 快照 | 提交 SHA | 主要意义 |
|---|---|---|
| 初始四页网站 | [`63d68dc3df`](https://github.com/Onesummer-D/mountain-spirit-showcase/commit/63d68dc3dfb90eacf531245a9e13befabfa57673) | L1 修改前基线 |
| L1 结束 | [`44d0af0354`](https://github.com/Onesummer-D/mountain-spirit-showcase/commit/44d0af035489c5aa55f93764b348626114cea5dc) | 活动名称改为「秋日手作节」 |
| L2 结束 | [`3aa545afe7`](https://github.com/Onesummer-D/mountain-spirit-showcase/commit/3aa545afe774f3ad44788452524c1ee512a6ef8e) | 商品专题页陶壶单独覆盖角标 |
| L3 结束 | [`226e1dddf2`](https://github.com/Onesummer-D/mountain-spirit-showcase/commit/226e1dddf2af6d1e3d6dee2e0f923cf18c62d155) | 当前中文品牌全站更名，保留历史旧名 |
| 后续 README | [`f838ae3361`](https://github.com/Onesummer-D/mountain-spirit-showcase/commit/f838ae3361e78219559426c9931bab6a3a7f5889) | L3 之后新增的项目说明 |

阶段比较可直接打开 GitHub：
- [L1：初始网站 → 活动更名](https://github.com/Onesummer-D/mountain-spirit-showcase/compare/63d68dc3dfb90eacf531245a9e13befabfa57673...44d0af035489c5aa55f93764b348626114cea5dc)
- [L2：活动更名 → 局部角标](https://github.com/Onesummer-D/mountain-spirit-showcase/compare/44d0af035489c5aa55f93764b348626114cea5dc...3aa545afe774f3ad44788452524c1ee512a6ef8e)
- [L3：局部角标 → 品牌更名](https://github.com/Onesummer-D/mountain-spirit-showcase/compare/3aa545afe774f3ad44788452524c1ee512a6ef8e...226e1dddf2af6d1e3d6dee2e0f923cf18c62d155)

### L1：活动更名

Git 两阶段对比仅涉及 `src/routes/autumn.tsx` 和 `src/routes/index.tsx`，对应秋季活动页的标题、SEO、宣传文案、优惠描述与首页横幅标题等。品牌故事的 2023 年「山野秋收」记录未在本次差异中被修改。**这证明实现范围，并不证明修改前默认聊天区曾主动展示影响预告或等待授权；后者依据用户此前的界面观察单独评价。**

### L2：商品专题页局部角标

Git 差异包含 5 个文件：`src/components/brand/shop.tsx`、`src/data/products.ts`、`src/routes/products.tsx`、`src/test/product-badges.test.tsx`、`roadmap.md`。三个运行源码文件的关键协作如下：

1. 共享目录保持 `p1.isNew=true`；`src/data/products.ts` 新增 `productsPageBadges = {p1:'秋日手作节'}`。
2. `ProductCard` 接受可选 `badge` 参数，取值逻辑为 `badge ?? (product.isNew ? '秋日新品' : undefined)`。
3. 仅 `src/routes/products.tsx` 为商品卡片传入 `badge={productsPageBadges[p.id]}`；首页与活动页复用同一商品数据、同一商品卡片，但不传覆盖值，继续显示默认角标。
4. 新增的四项组件测试分别检查覆盖映射、p1 商品专题角标、其他新品的默认角标、p1 在其他页面的默认角标。

**研究意义**：数据实体相同，不表示展示语义与修改范围相同。Ripple 应把「实体—组件—页面场景」视作相互连接但不能等同的层次；局部覆盖不应被自动升级为全局变更。

### L3：中文品牌更名

Git 差异涉及 7 个文件，其中 6 个运行源码文件、1 个内部路线文档：
`src/components/brand/layout.tsx`、`src/lib/brand-meta.ts`、`src/routes/__root.tsx`、`src/routes/index.tsx`、`src/routes/products.tsx`、`src/routes/story.tsx`、`roadmap.md`。

**独立复核的重点**：读取 L3 之前的快照 `3aa545afe7`，在上述 6 个运行源码文件中逐字统计「山野器物」，合计 **15 次字面量**：`layout.tsx` 4、`brand-meta.ts` 2、`__root.tsx` 2、`index.tsx` 3、`products.tsx` 1、`story.tsx` 3。秋季活动页本身为 0 次，但通过共享布局与品牌元数据受到间接影响。Lovable 第一阶段「15 处、6 文件」这一数量可被历史源码证实；**出现次数不等于屏幕上受影响的节点数量**。

L3 修改后的源码确认：共享 Logo、导航辅助阅读名称、页脚版权、页面标题生成器、根层默认标题与独立当前品牌文案被更新为「山野手作」；2018 年故事时间线中保留「山野器物的想法，在这里生根」，2023 年「山野秋收／秋日新品」历史内容与独立英文 `SHANYE OBJECTS` 未被替换；商品数据、角标及购物逻辑未因品牌名修改而变化。

**核验边界**：源码与 Diff 能证明最终具体改了什么；用户此前已完成五项人工验收，但本次仅通过 GitHub 阅读，没有重新启动三视口浏览器。最终运行效果继续以此前验收记录作为另一证据类别。

**历史文字的语义边界**：旧品牌名被保留是本次明确指令下的保护规则，而不是代码自动证实了 2018 年确实使用该商业名称。

## 二、自动化验证：有什么证据、没有什么证据

当前 Lovable 仓库包含 3 个 Vitest 测试文件，定义共 15 个测试用例：

- `src/test/products.test.ts`：7 个数据、商品数量、购物袋与价格计算相关用例；
- `src/test/app-routing.test.tsx`：4 个路由匹配用例；**注释明确说明这里不执行 loader 或渲染页面**；
- `src/test/product-badges.test.tsx`：4 个局部角标相关用例；**渲染的是 ProductCard + ShopProvider，不是完整商品专题路由页面**。

项目有 `vitest.config.ts`，也有 `npm test` 脚本。此前 Lovable Timeline 截图展示过执行 Vitest、运行 Playwright、截取桌面与手机界面及读取图片等行为；这些属于 **当时的工具轨迹/界面证据**。本次只读审计未执行测试，所以不声称在本次独立跑出了 15/15。

在此 Git 树中**未发现被提交的 Playwright 脚本、浏览器截图 PNG、截图生成报告、GitHub Actions 工作流或截图与提交版本对应的清单**。这不等于 Lovable 没有运行过 Playwright，而意味着这些临时执行产物并未在当前 Git 快照中提供持久化复核链路。

**重要纠偏**：已存在 Git SHA 与 Lovable History，并不证明 UI 内有「截图—提交 SHA—页面—视口—时间」自动一一绑定。Ripple 的“证据与代码版本绑定”目前应描述为拟探索的设计目标，而非本轮对 Lovable 缺失能力的绝对断言。

## 三、与 Bolt 的代码级比较

| 维度 | Bolt：当前上传的初始基线 | Lovable：L3 完成后的当前快照 | 解释边界 |
|---|---|---|---|
| 技术结构 | React 18、Vite 5、Tailwind 3 | React 19、TanStack Start/Router、Vite 8、Tailwind 4 | 是本次生成项目的栈，不代表平台只能使用此栈 |
| 页面导航 | `App.tsx` 用 `useState` 条件渲染四页 | TanStack 文件路由，每页有独立 URL | 技术实现方式不同 |
| 商品数据 | `src/data/products.ts` 汇总商品 | `src/data/products.ts` 统一九件商品 | 都有集中数据源 |
| 商品图片 | 商品及主视觉主要链接外部 Pexels URL | 本地 `src/assets` 图片，九宫格切出独立商品图片 | Lovable 的“独立文件”不等于九次独立图片生成 |
| 购物 | 当前 `ProductCard` 购买按钮没有 `onClick`，不能仅凭按钮外观视为可购买 | `ShopProvider` 提供详情、购物袋、数量修改和模拟结算 | 比较的是所上传版本，不能直接推断平台总体能力 |
| 页面级角标 | 当前共享 `ProductCard` 用商品 ID 判断标签，且各页面共享这一组件 | 显式 `productsPageBadges` 页面覆盖 | Lovable 的本次 L2 实现可复核为页面级范围控制 |
| 自动化测试 | 当前快照没有提交测试脚本或测试文件 | 有 3 文件、15 个 Vitest 用例 | 测试覆盖深度需要逐用例评估 |
| 历史 | Bolt 仓库目前只有 1 个初始提交 | Lovable 保留过程提交、L1–L3 完成节点 | Git 记录丰富程度受导出/同步方式影响 |

**比较限制**：两个初始项目的商品、品牌文案、设计素材、生成模板与用户任务并不完全相同；Bolt 目前是初始基线，Lovable 是多轮修改后工程。不能据此制定笼统「谁更强」的平台排行榜；还需结合用户视觉验收及同等任务下的独立重复实验。

**视觉与功能分开评估**：用户此前主观认为 Bolt 的页面更有设计品质，这是独立的视觉体验观察；Git 证据则显示 Lovable 当前工程有更完整的 URL 路由、客户端购物流程、局部展示覆盖及可复核测试源码。两项结论可以并存。

## 四、实验观察对 Ripple 的具体设计输入

本项目定位仍是：在真实网站的编辑过程中，把**结构涟漪、视觉涟漪与修改范围决策**整合为可理解的一次工作流程，不把单一 AST、Playwright、Diff 或回滚工具包装成独有功能。

### 1. 关联图要区分关系类型

L3 的可验证结构适合形成演示数据：用户提出 `山野器物 → 山野手作` 后，展示 Logo 复用关系、四页共享元数据、首页及故事页独立正文、历史时间线保护项、英文品牌名（待单独授权），以及图片中可能有但尚未验证的文字。

建议关系标签包括：`源码确定引用`、`页面渲染传播`、`同名文本候选`、`语义关联待判定`、`明确保护`。不能把所有搜索命中都染成“必须修改”。

### 2. 范围选择是页面与组件共同作用，而非文件勾选

L2 证明可针对同一 `p1` 产品在 `/products` 使用新角标，而 `/` 与 `/autumn` 保持旧角标。演示时需让用户直接在网页上看到：修改对象、会变的页面、不会变的页面、为何存在差异；允许在内容实体、组件实例和页面级覆盖之间选择合理的应用范围。

### 3. 预演需要“状态”和“证据来源”

技术基础可沿用原定 AST/ts-morph、运行时关联、AI 语义搜索、隔离工作树、Playwright 三视口、DOM/视觉差异与 Git 版本管理。建议每条证据记录 `commit/base SHA`、`candidate patch ID`、`route`、`viewport`、`interaction state`、`timestamp`、`test outcome` 与定位到的 DOM 元素；避免把旧截图误认为新补丁的验收结果。**此处是 Ripple 拟建数据结构，不是已在 Lovable 页面观察到的字段。**

### 4. 异常判定需要理解正常的交互状态

已有实验指出响应式导航折叠、滚动进入动画等可能造成不同视口/不同时刻的正常视觉差异。应先稳定截图条件（等待字体、图片、动画与目标元素状态），再结合 DOM、布局几何信息和行为断言定位问题，不能直接把像素差异当故障。

### 5. 信息呈现采用渐进层次

Lovable Timeline 能展开日志、测试、图片读取及代码 Diff；L3 第一阶段经明确提示后也能在默认聊天区提交完整分析并等待确认。但 L1、L2 普通修改阶段的前置分析多数仍需进入 Details 才能看见。可借鉴其详细日志层，同时优先在 Ripple 预览主界面展示用户决策所需的关系、范围、未验证点和风险。

### 6. 预演与正式应用要有清晰同一性

建议从冻结基线生成候选补丁，在隔离环境运行，选择范围后验证；用户确认后应用**同一份已验证的补丁**，并验证基线未变。如果源码或依赖变化，应作废旧证据或重新验证，避免“刚刚预演通过”无法对应最后提交的代码。

## 五、研究记录中的特别边界

1. L1、L2、L3 实验使用了不同详细程度的提示词；**L3 详细只读审计与等待确认属于用户明确要求后被触发的行为，不代表所有普通编辑都会如此进行**。
2. 项目 `roadmap.md` 标题仍是「山野器物」，是内部文档，不影响运行页面，不应把它未经授权的未改动自动定义为产品缺陷。
3. 根目录 `README.md` 仍保存**初始生成任务**中的旧品牌名和「山野秋收」，但该 README 是在 L3 结束后追加的；属于后来放入仓库的原始任务描述，不能追溯为 L3 当时审计漏改了网站运行内容。
4. 本次比较不等于我们直接观察到 Bolt 或 Lovable Agent 的全部内部能力。只能认定源代码、提交、提供过的界面截图以及用户人工验收支持的事实。
5. Lovable 的 Git 历史可复现三轮修改快照，但原生 Timeline、历史截图、临时执行脚本与 Git SHA 的自动对应关系，**当前没有可检查的导出证据**。
6. 最终网站的商品折扣、购买、图文排版由此前人工验收通过；本次工具只读 Git 仓库，没有执行构建、测试、浏览器回归，也没有修改仓库。

## 六、后续验证建议

若要把对照升级为可以公开展示的方法实验，可分别签出 Lovable 的四个阶段 SHA，在统一执行环境中重复安装、构建、执行测试，并以固定视口、相同浏览器版本、相同交互状态采集快照。Bolt 应保持自己的原始基线，另用独立实验分支实施同样三项变更，以免把两个原始数据不同的项目错误地当成像素级可比网站。

最终演示仍以**一个清晰的用户编辑动作**为中心：从编辑 → 发现依赖 → 展示涟漪 → 选择范围 → 隔离预演 → 视觉验证 → 确认应用 → 版本回溯。各技术模块只作为这段连贯体验的支撑。