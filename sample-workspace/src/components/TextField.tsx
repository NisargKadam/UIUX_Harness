import { useId } from "react";
import { cx } from "./cx";

export interface TextFieldProps {
  /** Visible label. Always required, for accessibility. */
  label: string;
  value: string;
  /** Called with the new string value. */
  onChange: (value: string) => void;
  type?: "text" | "email" | "password" | "tel" | "url" | "number" | "search";
  placeholder?: string;
  /** Hint shown under the field. */
  helperText?: string;
  /** Error message. When set, the field is styled as invalid. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Render a multi-line textarea instead of an input. */
  multiline?: boolean;
  /** Rows for a multiline field. */
  rows?: number;
  name?: string;
  autoComplete?: string;
}

/**
 * Single- or multi-line text input with label, helper text and error state.
 * @category Inputs
 * @example
 * <TextField label="Email" type="email" value={email} onChange={setEmail} helperText="We never share it." />
 */
export function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  helperText,
  error,
  required = false,
  disabled = false,
  multiline = false,
  rows = 3,
  name,
  autoComplete,
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const describedBy = error || helperText ? hintId : undefined;
  const common = {
    id,
    name,
    value,
    placeholder,
    required,
    disabled,
    autoComplete,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    className: cx("ds-field__control", error && "ds-field__control--invalid"),
  };
  return (
    <div className="ds-field">
      <label htmlFor={id} className="ds-field__label">
        {label}
        {required && <span className="ds-field__required" aria-hidden="true"> *</span>}
      </label>
      {multiline ? (
        <textarea {...common} rows={rows} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={type} onChange={(e) => onChange(e.target.value)} />
      )}
      {(error || helperText) && (
        <span id={hintId} className={cx("ds-field__hint", error && "ds-field__hint--error")}>
          {error ?? helperText}
        </span>
      )}
    </div>
  );
}
