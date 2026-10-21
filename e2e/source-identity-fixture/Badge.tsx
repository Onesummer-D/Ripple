// Only ever rendered as a JSX tag: keeps its hooks and a provable identity.
export function Badge({ text }: { text: string }) {
  return <mark data-testid="cross-badge">{text}</mark>
}
