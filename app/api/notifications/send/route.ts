import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 })

    const body = await req.json()
    const { type, title, message, referenceId, referenceType, link } = body

    if (!type || !title || !link) {
      return NextResponse.json({ error: 'Champs requis: type, title, link' }, { status: 400 })
    }

    const result = await createNotification({ type, title, message: message || '', referenceId: referenceId || '', referenceType: referenceType || '', link })
    return NextResponse.json(result)
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erreur serveur' }, { status: 500 })
  }
}
