import type { CaseFixture, CaseId, EditableSlot, RippleGraphNode } from '../domain/contracts'

const slot = (
  id: string,
  instanceId: string,
  sourceId: string,
  label: string,
  value: string,
  editKind: EditableSlot['editKind'],
  route: string,
  shared: boolean,
): EditableSlot => ({ id, instanceId, sourceId, label, value, editKind, route, shared })

const makeGraph = (caseId: CaseId, slots: EditableSlot[]) => {
  const nodes = new Map<string, RippleGraphNode>()
  slots.forEach((item) => {
    nodes.set(item.route + '-route', { id: item.route + '-route', caseId, kind: 'route', label: item.route, route: item.route })
    nodes.set(item.instanceId, { id: item.instanceId, caseId, kind: 'instance', label: item.label, route: item.route, sourceId: item.sourceId })
    nodes.set(item.id, { id: item.id, caseId, kind: 'slot', label: item.label, route: item.route, sourceId: item.sourceId })
    nodes.set(item.sourceId, { id: item.sourceId, caseId, kind: 'source', label: item.sourceId })
  })
  return {
    id: caseId + '-graph-fixture',
    caseId,
    nodes: [...nodes.values()],
    edges: slots.flatMap((item) => [
    { id: item.route + '-contains-' + item.instanceId, caseId, type: 'contains' as const, from: item.route + '-route', to: item.instanceId },
    { id: item.instanceId + '-reads-' + item.sourceId, caseId, type: 'reads' as const, from: item.instanceId, to: item.sourceId },
  ]),
  }
}

const qingyeSlots = [
  slot('qingye-home-title-slot', 'qingye-home-title', 'qingye-shared-title', '首页秋日标题', '秋日上新', 'TEXT', '/', true),
  slot('qingye-autumn-title-slot', 'qingye-autumn-title', 'qingye-shared-title', '活动页秋日标题', '秋日上新', 'TEXT', '/autumn', true),
  slot('qingye-collection-title-slot', 'qingye-collection-title', 'qingye-shared-title', '专题页秋日标题', '秋日上新', 'TEXT', '/collection', true),
  slot('qingye-about-title-slot', 'qingye-about-title', 'qingye-about-source', '品牌故事标题', '我们的故事', 'TEXT', '/about', false),
]

const qiguangSlots = [
  slot('qiguang-home-poster-slot', 'qiguang-home-hero', 'qiguang-shared-poster', '首页横幅海报', '/assets/qiguang-original.svg', 'MEDIA', '/', true),
  slot('qiguang-program-poster-slot', 'qiguang-program-wall', 'qiguang-shared-poster', '节目展墙海报', '/assets/qiguang-original.svg', 'MEDIA', '/program', true),
  slot('qiguang-tickets-poster-slot', 'qiguang-ticket-card', 'qiguang-shared-poster', '购票卡海报', '/assets/qiguang-original.svg', 'MEDIA', '/tickets', true),
  slot('qiguang-archive-poster-slot', 'qiguang-archive', 'qiguang-archive-poster', '往届回顾海报', '/assets/qiguang-archive.svg', 'MEDIA', '/archive', false),
]

const thirdPartySlots = [
  slot('thirdparty-accent-slot', 'thirdparty-primary-button', 'thirdparty-shared-token', '共享强调色', '#8B5CF6', 'TOKEN', '/showcase', true),
  slot('thirdparty-badge-slot', 'thirdparty-badge', 'thirdparty-shared-token', '状态标签', '#8B5CF6', 'TOKEN', '/showcase', true),
  slot('thirdparty-icon-slot', 'thirdparty-icon', 'thirdparty-shared-token', '导航图标', '#8B5CF6', 'TOKEN', '/docs', true),
]

const evidence = (caseId: CaseId, id: string, route: string, summary: string, viewport = 'fixture') => ({
  id,
  caseId,
  type: 'STRUCTURE' as const,
  route,
  viewport,
  summary,
  sourcePath: 'fixtures/' + caseId + '/' + id + '.json',
  verification: 'verified' as const,
  origin: 'fixture' as const,
})

export const fixtures: Record<CaseId, CaseFixture> = {
  qingye: {
    id: 'qingye',
    name: '青野文创',
    subtitle: '改一句话，决定影响范围',
    description: '共享标题会波及首页、秋季活动页与商品专题页；品牌故事页使用独立来源。',
    editKind: 'TEXT',
    accent: '#D8A36B',
    sourceLabel: 'campaign.autumn.title',
    slots: qingyeSlots,
    graph: makeGraph('qingye', qingyeSlots),
    evidence: [
      evidence('qingye', 'E-REF-QINGYE-001', '/', '三个共享消费位置与一个独立来源 Fixture'),
      evidence('qingye', 'E-VIEW-QINGYE-001', '/autumn', '活动页移动端风险待 B 的真实浏览器结果替换', '375x812'),
    ],
    fixtureIds: ['F01', 'F02', 'F03', 'F04'],
  },
  qiguang: {
    id: 'qiguang',
    name: '栖光艺术节',
    subtitle: '换一张海报，看见三种呈现',
    description: '同一张主视觉进入首页横幅、节目展墙与购票卡；Archive 独立保留旧图。',
    editKind: 'MEDIA',
    accent: '#F97316',
    sourceLabel: 'festival.shared.poster',
    slots: qiguangSlots,
    graph: makeGraph('qiguang', qiguangSlots),
    evidence: [
      evidence('qiguang', 'E-REF-QIGUANG-001', '/', '共享图片 Source 的三个容器 Fixture'),
      evidence('qiguang', 'E-VIEW-QIGUANG-001', '/program', '图片裁切结果待 B 的真实浏览器结果替换', '768x1024'),
    ],
    fixtureIds: ['F05', 'F06', 'F07'],
  },
  'third-party': {
    id: 'third-party',
    name: '第三方开源站',
    subtitle: '改一个强调色，看见整套联动',
    description: '保留真实 React/Vite 项目视觉，先以共享 Token Fixture 作为适配入口。',
    editKind: 'TOKEN',
    accent: '#8B5CF6',
    sourceLabel: 'theme.color.accent',
    slots: thirdPartySlots,
    graph: makeGraph('third-party', thirdPartySlots),
    evidence: [
      evidence('third-party', 'E-REF-THIRD-001', '/showcase', '共享色彩 Token 的消费位置 Fixture'),
      evidence('third-party', 'E-UNKNOWN-THIRD-001', '/docs', '真实消费关系待 B 冻结仓库后替换'),
    ],
    fixtureIds: ['F08', 'F09', 'F10'],
  },
}

export const caseOrder: CaseId[] = ['qingye', 'qiguang', 'third-party']
