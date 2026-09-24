import type { ReactNode } from 'react'

export function Group({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-[13px] font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}
