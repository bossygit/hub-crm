'use client'
import { useEffect, useState } from 'react'

export default function ConnectivityBanner() {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    setIsOnline(navigator.onLine)
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  if (isOnline) return null

  return (
    <div style={{
      background: '#92400e', color: 'white', padding: '8px 24px',
      textAlign: 'center', fontSize: '0.85rem', fontWeight: 600,
    }}>
      {'\u26a0\ufe0f'} Connexion internet instable — les données peuvent ne pas être à jour
    </div>
  )
}
