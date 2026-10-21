// Default export, re-exported through cells.ts and called as a plain callback.
export default function Cell(item: { id: string }) {
  return <td data-testid={`cross-cell-${item.id}`}>{item.id}</td>
}
