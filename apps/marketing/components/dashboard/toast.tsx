'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cheer } from '../cameo/dashboard-cameos.js';
import { SunnySpot } from '../sunny-spot.js';

/**
 * Toasts (brand guidelines D3, F): slide up with a bounce, bottom-right
 * (bottom on mobile), auto-dismiss after 4s and pause while hovered or
 * focused. Success toasts carry a small thumbs-up Sunny; errors never do.
 * Announced politely to screen readers.
 */
type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

interface ToastApi {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const Ctx = createContext<ToastApi>({ success: () => {}, error: () => {}, info: () => {} });

export function useToast(): ToastApi {
  return useContext(Ctx);
}

const LIFETIME_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const arm = useCallback(
    (id: number) => {
      window.clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), LIFETIME_MS),
      );
    },
    [dismiss],
  );

  const push = useCallback(
    (tone: Tone, text: string) => {
      const id = ++counter.current;
      setToasts((list) => [...list.slice(-2), { id, tone, text }]);
      arm(id);
    },
    [arm],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => {
        push('success', text);
        cheer();
      },
      error: (text) => push('error', text),
      info: (text) => push('info', text),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.tone}`}
            onMouseEnter={() => window.clearTimeout(timers.current.get(toast.id))}
            onMouseLeave={() => arm(toast.id)}
            onFocus={() => window.clearTimeout(timers.current.get(toast.id))}
            onBlur={() => arm(toast.id)}
          >
            {toast.tone === 'success' ? (
              <SunnySpot pose="thumbsUp" size={40} className="toast-sunny" />
            ) : (
              <span className="status-icon" aria-hidden="true">
                {toast.tone === 'error' ? '!' : 'i'}
              </span>
            )}
            <span className="toast-text">{toast.text}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
