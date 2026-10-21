// Default export, re-exported through cells.tsx and called as a plain callback.
export default function Cell(item: { id: string }) {
  return <td data-testid={`cross-cell-${item.id}`}>{item.id}</td>
}
