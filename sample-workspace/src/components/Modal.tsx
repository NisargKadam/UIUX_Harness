import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Action buttons, right-aligned at the bottom. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
}

/**
 * Dialog over the page for a short, focused task that should not lose the user's
 * place: confirm a deletion, edit one record. If the task needs its own URL or
 * more than one step, use a page instead.
 * @category Overlays
 * @example
 * <Modal open={open} onClose={() => setOpen(false)} title="Delete account?"
 *   footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger">Delete</Button></>}>
 *   This cannot be undone.
 * </Modal>
 */
export function Modal({ open, onClose, title, footer, size = "md", children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx("ds-modal", `ds-modal--${size}`)}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="ds-modal__header">
        <h2 id={titleId} className="ds-modal__title">
          {title}
        </h2>
        <button type="button" className="ds-modal__close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="ds-modal__body">{children}</div>
      {footer && <footer className="ds-modal__footer">{footer}</footer>}
    </dialog>
  );
}
