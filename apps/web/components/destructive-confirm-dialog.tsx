"use client";

import { useId, useRef, useState } from "react";

type DestructiveConfirmHandler = {
  (): Promise<boolean | void> | boolean | void;
};

type DestructiveConfirmDialogProps = {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  disabled?: boolean;
  onConfirm: DestructiveConfirmHandler;
};

export function DestructiveConfirmDialog({
  triggerLabel,
  title,
  description,
  confirmLabel,
  cancelLabel,
  disabled = false,
  onConfirm,
}: DestructiveConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [confirming, setConfirming] = useState(false);

  function openDialog() {
    const dialog = dialogRef.current;
    if (!dialog || disabled) return;
    dialog.showModal();
    requestAnimationFrame(() => cancelRef.current?.focus());
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  async function confirm() {
    setConfirming(true);
    try {
      const succeeded = await onConfirm();
      if (succeeded !== false) closeDialog();
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="dangerButton"
        disabled={disabled}
        type="button"
        aria-haspopup="dialog"
        onClick={openDialog}
      >
        {triggerLabel}
      </button>
      <dialog
        ref={dialogRef}
        className="destructiveDialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => triggerRef.current?.focus()}
      >
        <div className="destructiveDialogBody">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
          <div className="destructiveDialogActions">
            <button ref={cancelRef} className="secondary" type="button" onClick={closeDialog} disabled={confirming}>
              {cancelLabel}
            </button>
            <button className="dangerButton" type="button" onClick={() => void confirm()} disabled={confirming}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
