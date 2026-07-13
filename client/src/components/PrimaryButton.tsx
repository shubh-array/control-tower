import type { ButtonHTMLAttributes, ReactNode } from "react";

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  quiet?: boolean;
  children: ReactNode;
}

export function PrimaryButton({
  quiet = false,
  className,
  children,
  ...props
}: PrimaryButtonProps) {
  const variant = quiet ? "button--quiet" : "button--primary";
  const classes = ["button", variant, className].filter(Boolean).join(" ");

  return (
    <button {...props} className={classes}>
      {children}
    </button>
  );
}
