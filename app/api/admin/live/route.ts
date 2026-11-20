import { adminLive } from '@/lib/admin'
import { currentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user?.isAdmin) return Response.json({ error: 'Nicht gefunden' }, { status: 404 })
  return Response.json(await adminLive(), { headers: { 'Cache-Control': 'no-store' } })
}
