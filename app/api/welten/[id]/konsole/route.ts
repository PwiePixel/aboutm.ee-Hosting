import { currentUser } from '@/lib/auth'
import { consoleLines, getWorld } from '@/lib/worlds'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser()
  if (!user) return Response.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const world = getWorld(user.id, (await params).id)
  if (!world) return Response.json({ error: 'Nicht gefunden' }, { status: 404 })
  return Response.json(
    { status: world.status, lines: await consoleLines(world) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
