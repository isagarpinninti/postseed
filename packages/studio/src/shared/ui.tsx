import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SliderPrimitive from "@radix-ui/react-slider";
import clsx from "clsx";
import { AlertTriangle, Check, Info, Loader2, X } from "lucide-react";
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

/* ───────── logo ───────── */

export function Logo({ size = 28, label = true }: { size?: number; label?: boolean }): ReactNode {
  return (
    <span className="inline-flex select-none items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" role="img" aria-label="Postseed">
        <rect x="1.5" y="1.5" width="29" height="29" rx="8" className="fill-bg stroke-ink/35" strokeWidth="1.5" />
        <path d="M16 6.5c-4.6 4.6-6.2 8-6.2 11a6.2 6.2 0 0 0 12.4 0c0-3-1.6-6.4-6.2-11Z" className="stroke-ink" strokeWidth="2" strokeLinejoin="round" />
        <path d="M16 12v10" className="stroke-ink" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="16" cy="23.2" r="2" className="fill-seed" />
      </svg>
      {label ? <span className="text-[17px] font-semibold tracking-tight text-ink">Postseed</span> : null}
    </span>
  );
}

/* ───────── buttons ───────── */

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover border border-transparent font-medium",
  secondary: "bg-raised text-ink hover:bg-line border border-line-strong",
  ghost: "bg-transparent text-muted hover:text-ink hover:bg-raised border border-transparent",
  danger: "bg-danger text-white hover:bg-danger/90 border border-transparent font-medium",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(function IconButton({ label, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={clsx("inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink", className)}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ───────── fields ───────── */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(
        "h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-faint",
        "transition-colors hover:border-faint focus:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30",
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }): ReactNode {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, description, disabled, danger }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean; danger?: boolean }): ReactNode {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <CheckboxPrimitive.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className={clsx(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
          "border-line-strong bg-surface data-[state=checked]:border-ink data-[state=checked]:bg-accent disabled:opacity-45",
          danger && "data-[state=checked]:border-danger data-[state=checked]:bg-danger",
        )}
      >
        <CheckboxPrimitive.Indicator>
          <Check className={clsx("size-3", danger ? "text-white" : "text-on-accent")} strokeWidth={3} aria-hidden />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <label htmlFor={id} className="cursor-pointer text-[13px] leading-5 text-ink">
        {label}
        {description ? <span className="block text-xs text-faint">{description}</span> : null}
      </label>
    </div>
  );
}

export function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }): ReactNode {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong bg-surface p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={clsx("h-7 min-w-12 rounded px-2.5 text-[13px] transition-colors", active ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }): ReactNode {
  return (
    <SliderPrimitive.Root
      className="relative flex h-5 w-full touch-none select-none items-center"
      value={[value]}
      min={0}
      max={100}
      step={1}
      onValueChange={(v) => onChange(v[0] ?? 0)}
      aria-label={label}
    >
      <SliderPrimitive.Track className="relative h-1 grow rounded-full bg-line-strong">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-ink" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-4 rounded-full border-2 border-ink bg-bg shadow transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/60" aria-label={label} />
    </SliderPrimitive.Root>
  );
}

/* ───────── small pieces ───────── */

export const Kbd = ({ children }: { children: ReactNode }): ReactNode => (
  <kbd className="rounded border border-line-strong bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>
);

export const Skeleton = ({ className }: { className?: string }): ReactNode => <div aria-hidden className={clsx("skeleton", className)} />;

export const Pill = ({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "danger"; className?: string }): ReactNode => (
  <span
    className={clsx(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
      tone === "neutral" && "border-line-strong bg-raised text-muted",
      tone === "ok" && "border-ok/30 bg-ok/10 text-ok",
      tone === "warn" && "border-warn/30 bg-warn/10 text-warn",
      tone === "danger" && "border-danger/40 bg-danger/10 text-danger-ink",
      className,
    )}
  >
    {children}
  </span>
);

export function Banner({ tone = "info", children, actions, title }: { tone?: "info" | "warn" | "danger" | "ok"; children?: ReactNode; actions?: ReactNode; title?: ReactNode }): ReactNode {
  const Icon = tone === "info" ? Info : tone === "ok" ? Check : AlertTriangle;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={clsx(
        "flex items-start gap-3 rounded-lg border px-3.5 py-3 text-[13px]",
        tone === "info" && "border-line-strong bg-raised text-muted",
        tone === "ok" && "border-ok/30 bg-ok/10 text-ink",
        tone === "warn" && "border-warn/30 bg-warn/10 text-ink",
        tone === "danger" && "border-danger/40 bg-danger/10 text-ink",
      )}
    >
      <Icon className={clsx("mt-0.5 size-4 shrink-0", tone === "warn" && "text-warn", tone === "danger" && "text-danger-ink", tone === "ok" && "text-ok")} aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title ? <p className="font-medium text-ink">{title}</p> : null}
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export const Spinner = ({ className }: { className?: string }): ReactNode => <Loader2 aria-hidden className={clsx("size-4 animate-spin", className)} />;

/* ───────── modal ───────── */

export function Modal({ open, onOpenChange, title, description, children, width = 520, dismissible = true }: { open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; width?: number; dismissible?: boolean }): ReactNode {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => (dismissible || v) && onOpenChange(v)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          style={{ width }}
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          className="pop fixed left-1/2 top-1/2 z-50 max-h-[90vh] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-line-strong bg-surface p-6 shadow-2xl focus:outline-none"
        >
          <DialogPrimitive.Title className="text-lg font-semibold tracking-tight text-ink">{title}</DialogPrimitive.Title>
          {description ? <DialogPrimitive.Description className="mt-1 text-[13px] text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogPrimitive.Description>}
          <div className="mt-4">{children}</div>
          {dismissible ? (
            <DialogPrimitive.Close asChild>
              <IconButton label="Close" className="absolute right-3 top-3">
                <X className="size-4" aria-hidden />
              </IconButton>
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
