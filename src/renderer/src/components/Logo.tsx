/** Two press plates flattening a block: the SquashMedia mark. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="3.5" rx="1.75" fill="var(--color-ink-2)" />
      <rect x="5" y="9" width="14" height="6" rx="2.2" fill="var(--color-ember)" />
      <rect x="2.5" y="18" width="19" height="3.5" rx="1.75" fill="var(--color-ink-2)" />
    </svg>
  )
}
