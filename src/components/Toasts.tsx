import { memo } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import type { AppNotice } from "../types";

export type { ToastTone } from "../types";

interface ToastsProps {
  toasts: AppNotice[];
  onDismiss: (id: number) => void;
}

const ICONS = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

function Toast({ toast, onDismiss }: { toast: AppNotice; onDismiss: (id: number) => void }) {
  const Icon = ICONS[toast.tone];

  return (
    <div className={`toast toast-${toast.tone}`} role="status">
      <Icon size={15} strokeWidth={1.9} className="toast-icon" />
      <span className="toast-message">{toast.message}</span>
      <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        <X size={13} />
      </button>
    </div>
  );
}

export const Toasts = memo(function Toasts({ toasts, onDismiss }: ToastsProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
});
