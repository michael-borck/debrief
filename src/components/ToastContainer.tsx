import React from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useToast, ToastKind } from '../contexts/ToastContext';

const KIND_STYLES: Record<ToastKind, { icon: React.ComponentType<{ size?: number; className?: string }>; iconClass: string; border: string }> = {
  success: {
    icon: CheckCircle2,
    iconClass: 'text-emerald-500',
    border: 'border-l-emerald-500',
  },
  error: {
    icon: AlertCircle,
    iconClass: 'text-red-500',
    border: 'border-l-red-500',
  },
  info: {
    icon: Info,
    iconClass: 'text-primary-600',
    border: 'border-l-primary-600',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-amber-500',
    border: 'border-l-amber-500',
  },
};

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[1000] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((toast) => {
        const style = KIND_STYLES[toast.kind];
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto bg-white rounded-lg shadow-elevated border border-surface-200 border-l-4 ${style.border} p-4 animate-slide-up flex items-start gap-3`}
            style={{ animationDelay: '0s' }}
          >
            <Icon size={18} className={`${style.iconClass} flex-shrink-0 mt-0.5`} />
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-surface-900">{toast.title}</h4>
              {toast.body && (
                <p className="text-xs text-surface-600 mt-0.5">{toast.body}</p>
              )}
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-surface-400 hover:text-surface-700 transition-colors flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
