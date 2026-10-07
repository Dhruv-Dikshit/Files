"use client";

import Link from "next/link";
import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";
import type { Member } from "@/lib/domain/types";

/**
 * UI primitives styled after the "Split the Bill UI Kit" (Figma):
 * Button M / Button S, Tabbar, List, Order card, Counter, Tag, Avatar,
 * Navigation and the kit's icon set. Colours come from the theme tokens in
 * globals.css (bg-surface, text-ink, bg-accent, …).
 */

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ── Icons ─────────────────────────────────────────────────────────────────

export type IconName =
  | "home" | "bill" | "account" | "add-friend" | "delete" | "edit" | "close" | "camera"
  | "picture" | "arrow-back" | "search" | "ticket" | "notification";

/**
 * Kit icons (public/icons/*.svg, exported unmodified from Figma) rendered as
 * a CSS mask so they take the current text colour — e.g. grey when idle,
 * accent purple when active, exactly like the kit's tab bar states.
 */
export function Icon({ name, size = 24, className, label }: { name: IconName; size?: 16 | 20 | 24; className?: string; label?: string }) {
  const url = `url(/icons/${name}.svg)`;
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx("inline-block shrink-0 bg-current", className)}
      style={{ width: size, height: size, maskImage: url, WebkitMaskImage: url, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" }}
    />
  );
}

/** Kit "Radiobutton" (Active = purple check circle, Non active = grey ring). */
export function RadioMark({ checked }: { checked: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={checked ? "/icons/radio-on.svg" : "/icons/radio-off.svg"} alt="" width={24} height={24} className="shrink-0" />
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────

type Variant = "primary" | "action" | "secondary" | "ghost" | "danger" | "soft";
const variants: Record<Variant, string> = {
  // Button M › Default / Click (pressed text turns grey) / Disable (50%)
  primary: "bg-btn text-btn-ink active:text-muted disabled:opacity-50",
  // Button S › Apply (yellow)
  action: "bg-action text-[#19191d] disabled:opacity-50",
  secondary: "bg-surface text-ink disabled:opacity-50",
  soft: "bg-cloudy text-accent disabled:opacity-50",
  ghost: "text-muted hover:text-ink disabled:opacity-50",
  danger: "text-danger hover:bg-danger/10 disabled:opacity-50",
};

export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[12px] px-6 py-3 text-[14px] leading-6 transition disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function ButtonLink({ href, variant = "primary", className, children }: { href: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx("inline-flex items-center justify-center gap-2 rounded-[12px] px-6 py-3 text-[14px] leading-6 transition", variants[variant], className)}>
      {children}
    </Link>
  );
}

// ── Form fields ───────────────────────────────────────────────────────────

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full rounded-[14px] bg-surface px-4 py-3 text-[14px] leading-6 text-ink outline-none ring-1 ring-line transition placeholder:text-muted focus:ring-2 focus:ring-accent",
        className,
      )}
      {...props}
    />
  );
}

export const selectClass =
  "w-full rounded-[14px] bg-surface px-3 py-3 text-[14px] leading-6 text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-accent";

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] leading-5 text-muted">
      {children}
    </label>
  );
}

// ── Avatars ───────────────────────────────────────────────────────────────

/**
 * Kit "Avatar color": a radial-gradient circle. The kit shows memoji
 * illustrations inside; for real people we show their initials instead.
 */
export function Avatar({ member, size = 44, dimmed }: { member: Pick<Member, "name" | "avatarColor">; size?: number; dimmed?: boolean }) {
  const initials = member.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-medium transition", dimmed && "opacity-30 grayscale")}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.36),
        background: member.avatarColor ?? "#adb0b9",
        // Dark initials on the yellow gradient, white on the others.
        color: member.avatarColor?.includes("#f5db54") ? "#19191d" : "#ffffff",
      }}
    >
      {initials}
    </span>
  );
}

/** Kit "Avatar small": overlapping 20px avatars. */
export function AvatarStack({ members, max = 5, size = 20 }: { members: Pick<Member, "id" | "name" | "avatarColor">[]; max?: number; size?: number }) {
  return (
    <span className="flex">
      {members.slice(0, max).map((m, i) => (
        <span key={m.id} className="rounded-full ring-2 ring-surface" style={{ marginLeft: i === 0 ? 0 : -3 }}>
          <Avatar member={m} size={size} />
        </span>
      ))}
    </span>
  );
}

// ── Surfaces ──────────────────────────────────────────────────────────────

/** Kit "Order card" container: white, 20px radius, no border or shadow. */
export function Card({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx("rounded-[20px] bg-surface p-4", className)} style={style}>
      {children}
    </div>
  );
}

const TILES = ["tile-purple", "tile-green", "tile-yellow", "tile-grey"] as const;

/** Kit icon base: rounded gradient tile (Secondary gradients) holding an icon or emoji. */
export function IconTile({ children, size = 52, tone = 0, className }: { children: ReactNode; size?: number; tone?: number; className?: string }) {
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded-[16px] text-[#19191d]", TILES[Math.abs(tone) % TILES.length], className)}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

/** Kit "Tag": small pill, white by default, purple when active. */
export function Tag({ active, children, onClick, className }: { active?: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": active } : {})}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[30px] px-3 py-1 text-[11px] leading-6 transition",
        active ? "bg-accent text-white" : "bg-surface text-ink",
        className,
      )}
    >
      {children}
    </Comp>
  );
}

/** Kit "Counter": − value + on a white 10px-radius pill. */
export function Counter({ value, onChange, min = 0, label }: { value: number; onChange: (v: number) => void; min?: number; label: string }) {
  return (
    <span className="inline-flex h-7 items-center gap-3 rounded-[10px] bg-surface px-2.5 text-[15px] leading-6 ring-1 ring-line">
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(min, value - 1))} className={value <= min ? "text-muted" : "text-ink"}>
        −
      </button>
      <span className={cx("min-w-[10px] text-center tabular-nums", value === 0 ? "text-muted" : "text-ink")}>{value}</span>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(value + 1)} className="text-ink">
        +
      </button>
    </span>
  );
}

// ── Navigation ────────────────────────────────────────────────────────────

/** Kit "Navigation": back arrow · centred title · optional right action. */
export function NavBar({ title, backHref, action }: { title: string; backHref?: string; action?: ReactNode }) {
  return (
    <div className="relative flex h-[52px] items-center justify-center">
      {backHref && (
        <Link href={backHref} aria-label="Back" className="absolute left-0 p-1 text-muted hover:text-ink">
          <Icon name="arrow-back" />
        </Link>
      )}
      <h1 className="truncate px-10 text-[14px] font-medium leading-6">{title}</h1>
      {action && <div className="absolute right-0">{action}</div>}
    </div>
  );
}

/**
 * Kit "Tabbar": white pill, inactive items are grey icons, the active item
 * expands into a Cloudy pill with a purple icon + label.
 */
export function TabBar<T extends string>({ value, onChange, items, ariaLabel, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; icon: IconName }[]; ariaLabel: string; className?: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx("flex items-center justify-between rounded-[38px] bg-surface p-3", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={it.label}
            onClick={() => onChange(it.value)}
            className={cx(
              "flex items-center gap-[11px] rounded-[30px] py-3 transition-all",
              active ? "bg-cloudy px-5 text-accent" : "px-4 text-muted hover:text-ink",
            )}
          >
            <Icon name={it.icon} size={20} />
            {active && <span className="text-[11px] leading-4">{it.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Text-only variant of the tab bar pill, for choices without icons (split type, payer mode). */
export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[]; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1 overflow-x-auto rounded-[30px] bg-surface p-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex-1 whitespace-nowrap rounded-[30px] px-3 py-2 text-[12px] leading-4 transition",
            value === o.value ? "bg-cloudy font-medium text-accent" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────

/**
 * Accessible modal built on <dialog>: focus trapping, Esc-to-close and the
 * backdrop come for free. Renders as a bottom sheet on mobile.
 */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none rounded-t-[32px] bg-bg p-0 text-ink backdrop:bg-hero/40 backdrop:backdrop-blur-sm sm:m-auto sm:max-w-xl sm:rounded-[32px]"
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <header className="relative flex h-[60px] shrink-0 items-center justify-center px-5">
            <h2 className="text-[14px] font-medium leading-6">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 text-muted hover:text-ink">
              <Icon name="close" size={20} />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <footer className="px-5 py-4">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

// ── Money ─────────────────────────────────────────────────────────────────

/** Positive (you're owed) uses the kit accent; negative uses the danger token. */
export function Amount({ value, children }: { value: number; children: ReactNode }) {
  return <span className={cx("font-bold tabular-nums", value > 0 && "text-accent", value < 0 && "text-danger", value === 0 && "text-muted")}>{children}</span>;
}

/** Section caption, like the kit's grey 14pt labels ("Navigation", "Avatars"). */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <p className="text-[14px] leading-6 text-muted">{children}</p>
      {action}
    </div>
  );
}
