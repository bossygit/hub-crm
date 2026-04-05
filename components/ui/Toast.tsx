'use client'
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: string
  type: ToastType
  message: string
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

const COLORS: Record<ToastType, string> = {
  success: '#065f46',
  error: '#991b1b',
  warning: '#92400e',
  info: '#1e40af',
}

const ICONS: Record<ToastType, string> = {
  success: '\u2705',
  error: '\u274c',
  warning: '\u26a0\ufe0f',
  info: '\u2139\ufe0f',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((type: ToastType, message: string) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5000)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '12px 20px',
            borderRadius: 10,
            color: 'white',
            fontWeight: 600,
            fontSize: '0.875rem',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            background: COLORS[t.type],
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            maxWidth: 420,
            pointerEvents: 'auto',
            animation: 'toast-in 0.3s ease',
          }}>
            <span>{ICONS[t.type]}</span>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              style={{
                background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
                fontSize: '1rem', padding: '0 2px', lineHeight: 1,
              }}
            >
              \u2715
            </button>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(16px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </ToastContext.Provider>
  )
}
