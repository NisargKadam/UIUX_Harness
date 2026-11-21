import { useId } from "react";

export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Secondary line under the label explaining what the setting does. */
  description?: string;
  disabled?: boolean;
}

/**
 * On/off toggle for settings that apply immediately (no Save button needed).
 * For choices that are submitted with a form, prefer a checkbox-style pattern.
 * @category Inputs
 * @example
 * <Switch label="Email notifications" description="Weekly summary of activity" checked={on} onChange={setOn} />
 */
export function Switch({ label, checked, onChange, description, disabled = false }: SwitchProps) {
  const id = useId();
  return (
    <div className="ds-switch">
      <div className="ds-switch__text">
        <label htmlFor={id} className="ds-switch__label">
          {label}
        </label>
        {description && (
          <span id={`${id}-desc`} className="ds-switch__description">
            {description}
          </span>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        className="ds-switch__track"
        onClick={() => onChange(!checked)}
      >
        <span className="ds-switch__thumb" />
      </button>
    </div>
  );
}
