import type { CaseFixture, ScopeDecision } from '../domain/contracts'
import { relationshipProjection } from '../preview/relationship'

export function RelationshipMap({ fixture, sourceId, decision, onFocusRoute }: { fixture: CaseFixture; sourceId: string; decision?: ScopeDecision; onFocusRoute: (route: string) => void }) {
  const graph = relationshipProjection(fixture, sourceId, decision)
  return <section className="relationship-map" data-testid="relationship-map">
    <header><div><span className="eyebrow">RIPPLE / SOURCE RELATIONS</span><h3>来源与消费位置</h3></div><span className="relationship-count" role="status" data-testid="relationship-count">{graph.affectedCount} 个受影响实例</span></header>
    <svg viewBox={`0 0 560 ${graph.height}`} aria-hidden="true" className="relationship-svg">
      {graph.edges.map((edge) => <path key={edge.id} className={edge.affected ? 'relation-edge affected' : 'relation-edge'} data-edge-id={edge.id} d={`M ${edge.source.x + 35} ${edge.source.y} C 245 ${edge.source.y}, 245 ${edge.instance.y}, ${edge.instance.x - 20} ${edge.instance.y}`} />)}
      {graph.sources.map((node) => <g key={node.id} className={node.selected ? 'relation-source selected' : 'relation-source'}><circle cx={node.x} cy={node.y} r="37" className="source-ring" /><circle cx={node.x} cy={node.y} r="25" /><text x={node.x} y={node.y + 4} textAnchor="middle">Source</text><text x={node.x} y={node.y + 61} textAnchor="middle" className="relation-subtitle">{node.selected ? '当前来源' : '独立来源'}</text></g>)}
      {graph.instances.map((node) => <g key={node.id} className={node.affected ? 'relation-instance affected' : 'relation-instance'} data-instance-id={node.id}><circle cx={node.x} cy={node.y} r="17" /><text x={node.x + 26} y={node.y + 3}>{node.route}</text><text x={node.x + 26} y={node.y + 23} className="relation-subtitle">{node.affected ? '候选将波及' : node.unknown ? '来源待确认' : node.independent ? '独立来源' : '保持原值'}</text></g>)}
    </svg>
    <div className="relationship-links">{graph.instances.map((node) => <button type="button" key={node.id} className={node.affected ? 'relation-route affected' : 'relation-route'} onClick={() => node.route && onFocusRoute(node.route)} disabled={!node.route} data-testid={`relation-${node.id}`}><span>{node.label}</span><small>{node.route} · {node.affected ? '波及' : node.unknown ? '来源待确认' : node.independent ? '独立来源' : '保持'}</small></button>)}</div>
  </section>
}
