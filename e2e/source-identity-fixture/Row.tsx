// A hookless capitalized function; CrossApp.tsx calls it as a plain `.map` callback.
export function Row(item: { id: string; label: string }) {
  return <li data-testid={`cross-row-${item.id}`}>{item.label}</li>
}
