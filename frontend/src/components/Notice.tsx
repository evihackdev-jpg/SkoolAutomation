import { CheckCircle2, Info, X } from 'lucide-react';

interface NoticeProps {
  message: string;
  onDismiss: () => void;
  tone?: 'info' | 'success' | 'error';
}

export function Notice({ message, onDismiss, tone = 'info' }: NoticeProps) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-line bg-elevated px-4 py-3 text-[13px] text-ink-secondary"
    >
      {tone === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" /> : <Info size={16} className={`mt-0.5 shrink-0 ${tone === 'error' ? 'text-primary' : 'text-ink-secondary'}`} />}
      <p className="flex-1">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss message"
        className="rounded p-0.5 text-ink-muted transition-colors hover:text-ink"
      >
        <X size={14} />
      </button>
    </div>
  );
}
