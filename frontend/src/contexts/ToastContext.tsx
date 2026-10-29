import { createContext, useCallback, useContext, useState } from 'react';

type Tone = 'info' | 'success' | 'error' | 'signal';

interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => undefined);

const toneClass: Record<Tone, string> = {
  info: 'border-line bg-white text-ink',
  success: 'border-go/40 bg-go-soft text-ink',
  error: 'border-alert/40 bg-alert-soft text-ink',
  signal: 'border-signal bg-signal-soft text-ink',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[1000] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
        role="status"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto w-full max-w-md rounded-panel border px-4 py-3 text-sm font-medium ${toneClass[t.tone]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
