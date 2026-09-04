import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "outline" | "ghost";
type Size = "sm" | "md";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-signal text-void hover:bg-[#4ff0d1] disabled:bg-line-bright disabled:text-ink-faint shadow-[0_0_0_1px_rgba(55,230,196,0.4),0_0_16px_rgba(55,230,196,0.25)] disabled:shadow-none",
  outline:
    "border border-line-bright bg-panel-2 text-ink hover:border-signal hover:text-signal disabled:opacity-40",
  ghost: "text-ink-dim hover:bg-panel-2 hover:text-ink disabled:opacity-40",
};
const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-[11px] tracking-wide",
  md: "h-9 px-4 text-xs tracking-wide",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(
  ({ className = "", variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded font-display font-semibold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    />
  ),
);
Button.displayName = "Button";
