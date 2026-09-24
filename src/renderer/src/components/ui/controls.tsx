import * as RadixSelect from '@radix-ui/react-select'
import * as RadixSlider from '@radix-ui/react-slider'
import * as RadixSwitch from '@radix-ui/react-switch'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import { Check, ChevronDown } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'quiet' | 'plain' | 'danger' | 'raised'

export function Button({
  variant = 'quiet',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cn(
        'no-drag inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40',
        size === 'md' ? 'h-8 px-3' : 'h-7 px-2 text-[12px]',
        variant === 'primary' && 'bg-ink text-ground hover:bg-white active:bg-ink-2',
        variant === 'quiet' && 'bg-raised text-ink hover:bg-hover active:bg-press',
        variant === 'plain' && 'text-ink-2 hover:bg-raised hover:text-ink active:bg-hover',
        variant === 'danger' && 'bg-raised text-brick hover:bg-hover active:bg-press',
        // For buttons that sit on an already raised surface.
        variant === 'raised' && 'bg-hover text-ink hover:bg-press active:bg-press',
        className,
      )}
      {...props}
    />
  )
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          'no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tip>
  )
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export function Tip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!label) return <>{children}</>
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-md bg-press px-2.5 py-1.5 text-[12px] leading-snug text-ink shadow-[0_8px_24px_-6px_rgba(0,0,0,0.6)]"
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  hint?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div role="radiogroup" className={cn('flex rounded-lg bg-ground p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        const button = (
          <button
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-7 w-full min-w-0 truncate rounded-md px-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35',
              active ? 'bg-hover text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {o.label}
          </button>
        )
        // Every option sits in an equal-width cell; the cell also lets
        // tooltips work on disabled buttons.
        const cell = <span className="flex min-w-0 flex-1">{button}</span>
        return o.hint ? (
          <Tip key={o.value} label={o.hint}>
            {cell}
          </Tip>
        ) : (
          <span key={o.value} className="flex min-w-0 flex-1">
            {button}
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  band,
  ariaLabel,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  /** Highlighted "sweet spot" range drawn under the track. */
  band?: [number, number]
  ariaLabel: string
}) {
  const pct = (v: number): number => ((v - min) / (max - min)) * 100
  return (
    <RadixSlider.Root
      className="relative flex h-5 w-full touch-none items-center select-none"
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => onChange(v)}
      aria-label={ariaLabel}
    >
      <RadixSlider.Track className="relative h-1 grow overflow-hidden rounded-full bg-press">
        {band && (
          <span
            className="absolute inset-y-0 bg-ember-3"
            style={{ left: `${pct(band[0])}%`, width: `${pct(band[1]) - pct(band[0])}%` }}
          />
        )}
        <RadixSlider.Range className="absolute h-full rounded-full bg-ember-2" />
      </RadixSlider.Track>
      <RadixSlider.Thumb className="block h-3.5 w-3.5 rounded-full bg-ink shadow-[0_1px_3px_rgba(0,0,0,0.5)] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ember" />
    </RadixSlider.Root>
  )
}

/** Two-thumb slider for picking a range, such as a trim. */
export function RangeSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
}: {
  value: [number, number]
  min: number
  max: number
  step?: number
  onChange: (v: [number, number]) => void
  ariaLabel: string
}) {
  const thumb =
    'block h-3.5 w-3.5 rounded-full bg-ink shadow-[0_1px_3px_rgba(0,0,0,0.5)] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ember'
  return (
    <RadixSlider.Root
      className="relative flex h-5 w-full touch-none items-center select-none"
      value={value}
      min={min}
      max={max}
      step={step}
      minStepsBetweenThumbs={1}
      onValueChange={([a, b]) => onChange([a, b])}
      aria-label={ariaLabel}
    >
      <RadixSlider.Track className="relative h-1 grow overflow-hidden rounded-full bg-press">
        <RadixSlider.Range className="absolute h-full rounded-full bg-ember-2" />
      </RadixSlider.Track>
      <RadixSlider.Thumb className={thumb} aria-label="Start" />
      <RadixSlider.Thumb className={thumb} aria-label="End" />
    </RadixSlider.Root>
  )
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={cn('flex cursor-pointer items-start justify-between gap-3 py-1', disabled && 'cursor-not-allowed opacity-40')}>
      <span className="min-w-0">
        <span className="block text-ink">{label}</span>
        {hint && <span className="block text-[12px] text-ink-3">{hint}</span>}
      </span>
      <RadixSwitch.Root
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full bg-press transition-colors data-[state=checked]:bg-ember-2"
      >
        <RadixSwitch.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-ink transition-transform data-[state=checked]:translate-x-4" />
      </RadixSwitch.Root>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export interface SelectOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  detail?: ReactNode
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  placeholder,
  size = 'md',
}: {
  value: T | ''
  options: SelectOption<T>[]
  onChange: (v: T) => void
  ariaLabel: string
  className?: string
  /** Shown when `value` matches no option. */
  placeholder?: string
  size?: 'sm' | 'md'
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <RadixSelect.Trigger
        aria-label={ariaLabel}
        className={cn(
          'no-drag inline-flex items-center justify-between gap-2 rounded-md text-left text-ink transition-colors hover:bg-hover data-[state=open]:bg-hover',
          size === 'md' ? 'h-8 w-full bg-ground px-2.5' : 'h-6 px-1.5 text-[12px]',
          className,
        )}
      >
        <span className="truncate data-[placeholder]:text-ink-3">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon>
          <ChevronDown size={14} className="text-ink-3" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg bg-raised p-1 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.7)]"
        >
          <RadixSelect.Viewport>
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-default items-center justify-between gap-4 rounded-md py-1.5 pr-2 pl-7 text-ink outline-none select-none data-[disabled]:opacity-35 data-[highlighted]:bg-hover"
              >
                <RadixSelect.ItemIndicator className="absolute left-2">
                  <Check size={13} className="text-ember" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                {o.detail && <span className="text-[12px] text-ink-3">{o.detail}</span>}
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function Field({ label, value, children, hint }: { label: ReactNode; value?: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink-2">{label}</span>
        {value !== undefined && <span className="num text-[12px] text-ink">{value}</span>}
      </div>
      {children}
      {hint && <p className="text-[12px] leading-snug text-ink-3">{hint}</p>}
    </div>
  )
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3 px-4 py-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[13px] font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  ariaLabel,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  ariaLabel: string
}) {
  return (
    <div className="flex h-8 items-center rounded-md bg-ground pr-2.5 focus-within:bg-hover">
      <input
        type="number"
        aria-label={ariaLabel}
        className="num h-full w-full min-w-0 bg-transparent pl-2.5 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number.parseFloat(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
        onBlur={(e) => {
          const n = Number.parseFloat(e.target.value)
          let v = Number.isFinite(n) ? n : (min ?? 0)
          if (min !== undefined) v = Math.max(min, v)
          if (max !== undefined) v = Math.min(max, v)
          if (v !== value) onChange(v)
        }}
      />
      {suffix && <span className="shrink-0 text-[12px] text-ink-3">{suffix}</span>}
    </div>
  )
}

/** A small horizontal meter for utilisation readouts. */
export function Meter({ value, className }: { value: number | null; className?: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <span className={cn('relative inline-block h-1 w-10 overflow-hidden rounded-full bg-press', className)}>
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500', v > 85 ? 'bg-ember' : 'bg-ember-2')}
        style={{ width: `${v}%` }}
      />
    </span>
  )
}

export function ProgressBar({ value, indeterminate, className }: { value: number; indeterminate?: boolean; className?: string }) {
  return (
    <div className={cn('relative h-1 overflow-hidden rounded-full bg-press', className)}>
      {indeterminate ? (
        <div className="absolute inset-y-0 w-1/3 rounded-full bg-ember-2 [animation:sweep_1.2s_ease-in-out_infinite]" />
      ) : (
        <div className="absolute inset-y-0 left-0 rounded-full bg-ember-2 transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      )}
    </div>
  )
}
