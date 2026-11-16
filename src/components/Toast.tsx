import { CheckCircle2, Info, AlertCircle, X } from 'lucide-react';
import type { ToastMessage } from '../types/creator';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 flex w-full max-w-sm flex-col gap-2.5 px-4 sm:px-0"
    >
      {toasts.map((toast) => {
        const Icon =
          toast.variant === 'success'
            ? CheckCircle2
            : toast.variant === 'error'
            ? AlertCircle
            : Info;
        const iconColor =
          toast.variant === 'success'
            ? 'text-emerald-600 dark:text-emerald-400'
            : toast.variant === 'error'
            ? 'text-rose-600 dark:text-rose-400'
            : 'text-sky-600 dark:text-sky-400';

        return (
          <div
            key={toast.id}
            className="flex items-start gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)]/95 p-3.5 shadow-[var(--shadow-popover)] backdrop-blur-md transition-all duration-200"
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {toast.title}
              </p>
              {toast.description && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {toast.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
