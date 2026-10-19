import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

interface FieldShell {
  label: string;
  hint?: string;
  error?: string | null;
}

function Shell({ id, label, hint, error, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error ? <span className="hint" id={`${id}-hint`}>{hint}</span> : null}
      {error ? <span className="error-text" id={`${id}-err`} role="alert">{error}</span> : null}
    </div>
  );
}

const describe = (id: string, p: FieldShell) => (p.error ? `${id}-err` : p.hint ? `${id}-hint` : undefined);

export function Input({ label, hint, error, className, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <input id={id} className={cx("input", className)} aria-invalid={error ? true : undefined} aria-describedby={describe(id, { label, hint, error })} {...rest} />
    </Shell>
  );
}

export function Select({ label, hint, error, className, children, ...rest }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <select id={id} className={cx("select", className)} aria-invalid={error ? true : undefined} aria-describedby={describe(id, { label, hint, error })} {...rest}>
        {children}
      </select>
    </Shell>
  );
}

export function Textarea({ label, hint, error, className, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <textarea id={id} className={cx("textarea", className)} aria-invalid={error ? true : undefined} aria-describedby={describe(id, { label, hint, error })} {...rest} />
    </Shell>
  );
}
