import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

/** A top bar button that opens a window-sized dialog. */
export function ModalTrigger({ icon, label, badge }: { icon: ReactNode; label: string; badge?: boolean }) {
  return (
    <Dialog.Trigger asChild>
      <button
        type="button"
        className="no-drag relative flex h-8 items-center gap-1.5 rounded-md px-2.5 text-ink-2 transition-colors hover:bg-raised hover:text-ink data-[state=open]:bg-raised data-[state=open]:text-ink"
      >
        {icon}
        {label}
        {badge && <span className="absolute top-1.5 right-1 h-1.5 w-1.5 rounded-full bg-ember" aria-hidden />}
      </button>
    </Dialog.Trigger>
  )
}

export function ModalBody({
  title,
  description,
  width = 540,
  children,
  footer,
  className,
}: {
  title: string
  description: string
  width?: number
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-ground/75" />
      <Dialog.Content
        style={{ width }}
        className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-raised shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] outline-none"
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <Dialog.Title className="font-display text-[16px] font-semibold text-ink">{title}</Dialog.Title>
          <Dialog.Close asChild>
            <button type="button" aria-label="Close" className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
              <X size={16} />
            </button>
          </Dialog.Close>
        </div>
        <Dialog.Description className="sr-only">{description}</Dialog.Description>
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 pb-6 text-[13px]', className)}>{children}</div>
        {footer && <div className="flex items-center justify-between gap-3 rounded-b-2xl bg-panel px-6 py-3.5">{footer}</div>}
      </Dialog.Content>
    </Dialog.Portal>
  )
}
