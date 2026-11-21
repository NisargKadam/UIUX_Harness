import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export interface TabItem {
  id: string;
  label: string;
  /** Optional count shown next to the label, e.g. unread items. */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  /** id of the selected tab (controlled). */
  selectedId: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab list, e.g. "Settings sections". */
  ariaLabel: string;
  /** Content of the selected tab. Rendered inside the tab panel. */
  children?: ReactNode;
}

/**
 * Switches between sibling views of the same object or page (e.g. Profile /
 * Notifications / Billing). Controlled: the parent owns which tab is selected,
 * which makes it easy to sync with a route. Arrow keys move between tabs.
 * @category Navigation
 * @example
 * <Tabs ariaLabel="Settings sections" items={[{ id: "profile", label: "Profile" }, { id: "notifications", label: "Notifications" }]}
 *   selectedId={tab} onChange={setTab}>
 *   {tab === "profile" ? <ProfileForm /> : <NotificationSettings />}
 * </Tabs>
 */
export function Tabs({ items, selectedId, onChange, ariaLabel, children }: TabsProps) {
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = items.filter((i) => !i.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const index = enabled.findIndex((i) => i.id === selectedId);
    let next: number;
    if (e.key === "ArrowRight") next = (index + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    else return;
    e.preventDefault();
    const target = enabled[next];
    if (target) {
      onChange(target.id);
      refs.current[items.indexOf(target)]?.focus();
    }
  };

  return (
    <div className="ds-tabs">
      <div role="tablist" aria-label={ariaLabel} className="ds-tabs__list">
        {items.map((item, i) => {
          const selected = item.id === selectedId;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`${baseId}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={cx("ds-tabs__tab", selected && "ds-tabs__tab--selected")}
              onClick={() => onChange(item.id)}
              onKeyDown={onKeyDown}
            >
              {item.label}
              {item.count !== undefined && <span className="ds-tabs__count">{item.count}</span>}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${selectedId}`} className="ds-tabs__panel" tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
