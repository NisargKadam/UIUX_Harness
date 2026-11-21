import { useId } from "react";
import { cx } from "./cx";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Shown as a disabled first option when value is empty. */
  placeholder?: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  name?: string;
}

/**
 * Native dropdown for choosing one option from a short list (up to ~15 items).
 * @category Inputs
 * @example
 * <Select label="Time zone" value={tz} onChange={setTz} options={[{ value: "utc", label: "UTC" }]} />
 */
export function Select({ label, options, value, onChange, placeholder, helperText, error, required = false, disabled = false, name }: SelectProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="ds-field">
      <label htmlFor={id} className="ds-field__label">
        {label}
        {required && <span className="ds-field__required" aria-hidden="true"> *</span>}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || helperText ? hintId : undefined}
        className={cx("ds-field__control", "ds-select", error && "ds-field__control--invalid")}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {(error || helperText) && (
        <span id={hintId} className={cx("ds-field__hint", error && "ds-field__hint--error")}>
          {error ?? helperText}
        </span>
      )}
    </div>
  );
}
