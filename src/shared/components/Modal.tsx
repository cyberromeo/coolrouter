"use client";

import { useEffect, useRef, useId } from "react";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";

// Open modals, innermost last. Several can be stacked (a confirm dialog over an editor),
// so scroll locking and Escape have to know which one is on top.
const openModals: symbol[] = [];

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  closeOnOverlay?: boolean;
  showCloseButton?: boolean;
  className?: string;
  maxWidth?: string;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnOverlay = true,
  showCloseButton = true,
  className,
  maxWidth,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const modalKey = useRef(Symbol("modal"));
  // Keep the latest onClose without re-running the effects when the parent passes a new
  // inline function on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-4xl",
  };

  // Lock body scroll while any modal is open. Closing one of two stacked modals must
  // not unlock the page under the one that is still showing.
  useEffect(() => {
    if (!isOpen) return;
    const key = modalKey.current;
    openModals.push(key);
    document.body.style.overflow = "hidden";
    return () => {
      const index = openModals.lastIndexOf(key);
      if (index !== -1) openModals.splice(index, 1);
      if (openModals.length === 0) document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Escape closes only the topmost modal.
  useEffect(() => {
    if (!isOpen) return;
    const key = modalKey.current;
    const handleEscape = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (openModals[openModals.length - 1] !== key) return;
      onCloseRef.current?.();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  // Focus trap
  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;

    const dialog = dialogRef.current;
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    // Give focus back to whatever opened the modal when it closes.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Start in the body (the first field) rather than on the close button in the header.
    const firstFocusable =
      dialog.querySelector(`[data-modal-body] :is(${focusableSelector})`) ||
      dialog.querySelector(focusableSelector);
    const focusTimer = setTimeout(() => {
      if (firstFocusable && !dialog.contains(document.activeElement)) firstFocusable.focus();
    }, 50);

    const handleTab = (e) => {
      if (e.key !== "Tab") return;

      const focusable = [...dialog.querySelectorAll(focusableSelector)];
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", handleTab);
    return () => {
      clearTimeout(focusTimer);
      dialog.removeEventListener("keydown", handleTab);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={closeOnOverlay ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "relative w-full bg-surface",
          "border border-border",
          "rounded-xl shadow-2xl",
          "animate-in fade-in zoom-in-95 duration-200",
          // `maxWidth` is the older name some callers still pass for `size`.
          sizes[maxWidth && maxWidth in sizes ? maxWidth : size],
          className
        )}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center">
              {title && (
                <h2 id={titleId} className="text-lg font-semibold text-text-main">
                  {title}
                </h2>
              )}
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                  close
                </span>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div data-modal-body className="p-6 max-h-[calc(80vh-140px)] overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Confirm Modal helper
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  loading = false,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={variant as any} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-text-muted">{message}</p>
    </Modal>
  );
}
