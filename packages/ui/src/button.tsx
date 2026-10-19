import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "quiet" | "danger";
  size?: "default" | "small";
}

export function Button({ variant = "default", size = "default", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("btn", variant === "primary" && "btn-primary", variant === "quiet" && "btn-quiet", variant === "danger" && "btn-danger", size === "small" && "btn-small", className)}
      {...rest}
    />
  );
}
