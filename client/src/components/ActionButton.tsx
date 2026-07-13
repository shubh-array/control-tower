import type { ButtonHTMLAttributes, ReactNode } from "react";
import { PrimaryButton } from "./PrimaryButton.js";

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  quiet?: boolean;
  busy?: boolean;
  busyLabel?: ReactNode;
  children: ReactNode;
}

export function ActionButton({
  quiet = false,
  busy = false,
  busyLabel,
  disabled,
  children,
  ...props
}: ActionButtonProps) {
  return (
    <PrimaryButton
      {...props}
      quiet={quiet}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && busyLabel !== undefined ? busyLabel : children}
    </PrimaryButton>
  );
}
