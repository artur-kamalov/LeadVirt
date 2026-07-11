import React from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SelectPrimitive from "@radix-ui/react-select";
import { motion, AnimatePresence } from "motion/react";
import { X, Loader2, Inbox, AlertTriangle, Check, ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { useTheme } from "./theme";
import { Button } from "../components/ui/Button";

/* Helper: theme class for portaled content (portals render outside the
   ProductLayout root, so they need the theme flag on their own root). */
function useThemeClass() {
  const { theme } = useTheme();
  return theme === "light" ? "theme-light" : "";
}

/* ============================================================
   Tooltip
   ============================================================ */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}>{children}</TooltipPrimitive.Provider>;
}

export function Tip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const themeClass = useThemeClass();
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className={cn(
            themeClass,
            "z-[100] rounded-xl border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-100 shadow-xl shadow-black/40",
            "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95"
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-zinc-900" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ============================================================
   Dropdown menu
   ============================================================ */
export function Dropdown({
  trigger,
  children,
  align = "end",
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const themeClass = useThemeClass();
  return (
    <DropdownPrimitive.Root>
      <DropdownPrimitive.Trigger asChild>{trigger}</DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content
          align={align}
          sideOffset={8}
          className={cn(
            themeClass,
            "z-[100] min-w-[220px] origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-2xl border border-white/10 bg-zinc-900 p-1.5 shadow-2xl shadow-black/50",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            className
          )}
        >
          {children}
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  );
}

export function DropdownItem({
  icon: Icon,
  children,
  onClick,
  danger = false,
  className,
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  className?: string;
}) {
  return (
    <DropdownPrimitive.Item
      onSelect={() => {
        onClick?.();
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none transition-colors",
        danger
          ? "text-rose-400 focus:bg-rose-500/10 data-[highlighted]:bg-rose-500/10"
          : "text-zinc-300 focus:bg-white/5 focus:text-zinc-50 data-[highlighted]:bg-white/5 data-[highlighted]:text-zinc-50",
        className
      )}
    >
      {Icon && <Icon className="w-4 h-4 opacity-80" />}
      <span className="flex-1">{children}</span>
    </DropdownPrimitive.Item>
  );
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{children}</div>;
}

export function DropdownSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-white/8" />;
}

/* ============================================================
   Select (brand-styled, replaces native <select>)
   ============================================================ */
export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder = "Выберите...",
  className,
  ariaLabel,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const themeClass = useThemeClass();
  return (
    <SelectPrimitive.Root value={value} defaultValue={defaultValue} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "group flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-zinc-100 outline-none transition-colors hover:border-white/20 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 data-[placeholder]:text-zinc-500",
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="w-4 h-4 text-zinc-500 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={8}
          className={cn(
            themeClass,
            "z-[110] max-h-[300px] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 p-1.5 shadow-2xl shadow-black/50",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
          )}
        >
          <SelectPrimitive.Viewport className="p-0">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center rounded-xl px-3 py-2 pr-9 text-sm text-zinc-300 outline-none transition-colors data-[highlighted]:bg-white/5 data-[highlighted]:text-zinc-50 data-[state=checked]:text-emerald-400"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex items-center">
                  <Check className="w-4 h-4" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/* ============================================================
   Modal (Dialog)
   ============================================================ */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  ariaTitle,
  ariaDescription,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Accessible label used when no visible `title` is rendered. */
  ariaTitle?: string;
  /** Accessible description used when no visible `description` is rendered. */
  ariaDescription?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const themeClass = useThemeClass();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            themeClass,
            "fixed left-1/2 top-1/2 z-[91] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] min-w-0 max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-x-hidden overflow-y-auto rounded-3xl border border-white/10 bg-zinc-900 p-6 text-zinc-50 shadow-2xl shadow-black/60",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            className
          )}
        >
          <div className="relative min-w-0">
            {/* Always render an accessible title + description (Radix requirement).
                Falls back to sr-only when no visible title/description is provided. */}
            {title ? (
              <DialogPrimitive.Title className="text-xl font-bold tracking-tight text-zinc-50 mb-1.5 pr-8">{title}</DialogPrimitive.Title>
            ) : (
              <DialogPrimitive.Title className="sr-only">{ariaTitle ?? "Диалог"}</DialogPrimitive.Title>
            )}
            {description ? (
              <DialogPrimitive.Description className="text-sm text-zinc-400 mb-5">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{ariaDescription ?? "Диалоговое окно"}</DialogPrimitive.Description>
            )}
            {children}
            {footer && <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">{footer}</div>}
          </div>
          <DialogPrimitive.Close className="absolute right-5 top-5 w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ============================================================
   Confirm dialog
   ============================================================ */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      ariaTitle={title}
      ariaDescription={description}
      className="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button
            className={danger ? "bg-rose-500 text-white hover:bg-rose-600" : ""}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        <div className={cn("w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center", danger ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400")}>
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold tracking-tight text-zinc-50">{title}</h3>
          {description && <p className="mt-1.5 text-sm text-zinc-400">{description}</p>}
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================
   Empty state
   ============================================================ */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex flex-col items-center justify-center text-center py-16 px-6", className)}
    >
      <div className="relative mb-5">
        <div className="relative w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-500">
          <Icon className="w-7 h-7" />
        </div>
      </div>
      <h3 className="text-base font-semibold text-zinc-200">{title}</h3>
      {description && <p className="mt-1.5 text-sm text-zinc-500 max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

/* ============================================================
   Skeleton / Loading
   ============================================================ */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-white/5", className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("animate-spin text-emerald-400", className)} />;
}

export function LoadingOverlay({ label = "Загрузка..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Spinner className="w-7 h-7" />
      <span className="text-sm text-zinc-500">{label}</span>
    </div>
  );
}

/* ============================================================
   Status badge (success / error / warning / info)
   ============================================================ */
const statusStyles = {
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  error: "bg-rose-500/15 text-rose-400 border-rose-500/25",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  info: "bg-sky-500/15 text-sky-400 border-sky-500/25",
};

export function StatusBadge({
  status,
  children,
}: {
  status: keyof typeof statusStyles;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", statusStyles[status])}>
      {children}
    </span>
  );
}

export { AnimatePresence };
