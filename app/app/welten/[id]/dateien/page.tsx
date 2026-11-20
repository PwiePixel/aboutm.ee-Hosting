import { ChevronLeft, FileText, Folder } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DeleteEntry, FileEditor, NewFolder } from '@/components/world-files'
import { requireUser } from '@/lib/auth'
import { FileError, listDirectory, readTextFile, type FileEntry } from '@/lib/files'
import { formatBytes, formatRelative } from '@/lib/format'
import { getWorld } from '@/lib/worlds'

export const metadata: Metadata = { title: 'Dateien' }

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ pfad?: string; datei?: string }>
}) {
  const user = await requireUser()
  const world = getWorld(user.id, (await params).id)
  if (!world) notFound()

  const query = await searchParams
  const base = `/app/welten/${world.id}/dateien`
  const folderLink = (path: string) => (path ? `${base}?pfad=${encodeURIComponent(path)}` : base)
  const running = world.status === 'starting' || world.status === 'online'

  // ── Eine Datei bearbeiten ──
  if (typeof query.datei === 'string' && query.datei) {
    const path = query.datei
    const parent = path.split('/').slice(0, -1).join('/')
    let content: string | null = null
    let problem: string | null = null
    try {
      content = readTextFile(world.id, path)
    } catch (error) {
      if (!(error instanceof FileError)) throw error
      problem = error.message
    }
    return (
      <section>
        <Link href={folderLink(parent)} className="inline-flex items-center gap-1.5 text-[14px] text-ink-dim hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden />
          Zurück zum Ordner
        </Link>
        <h2 className="mt-4 break-all font-mono text-[15px] font-semibold">/{path}</h2>
        {running && (
          <p className="mt-2 text-[13px] text-ink-faint">
            Deine Welt läuft gerade. Die meisten Änderungen an Konfigurationsdateien greifen erst nach einem Neustart.
          </p>
        )}
        <div className="mt-4">
          {content === null ? (
            <p className="notice notice-error">{problem}</p>
          ) : (
            <FileEditor worldId={world.id} path={path} content={content} />
          )}
        </div>
      </section>
    )
  }

  // ── Einen Ordner anzeigen ──
  const folder = typeof query.pfad === 'string' ? query.pfad : ''
  let entries: FileEntry[] = []
  let problem: string | null = null
  try {
    entries = listDirectory(world.id, folder)
  } catch (error) {
    if (!(error instanceof FileError)) throw error
    problem = error.message
  }
  const crumbs = folder.split('/').filter(Boolean)

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="eyebrow">Dateien</h2>
          <p className="mt-2 text-[14px] text-ink-dim">
            Textdateien bis 512 KiB lassen sich öffnen und bearbeiten. Kein Up- oder Download.
          </p>
        </div>
        {!problem && <NewFolder worldId={world.id} folder={folder} />}
      </div>

      <nav aria-label="Pfad" className="mt-5 flex flex-wrap items-center gap-1 font-mono text-[14px] text-ink-dim">
        <Link href={base} className="px-1 hover:text-ink">
          /
        </Link>
        {crumbs.map((crumb, index) => (
          <span key={index} className="flex items-center gap-1">
            <Link href={folderLink(crumbs.slice(0, index + 1).join('/'))} className="hover:text-ink">
              {crumb}
            </Link>
            <span aria-hidden>/</span>
          </span>
        ))}
      </nav>

      {problem ? (
        <p className="notice notice-error mt-3">{problem}</p>
      ) : entries.length === 0 ? (
        <p className="panel mt-3 px-4 py-7 text-center text-[14px] text-ink-dim">
          {folder ? 'Dieser Ordner ist leer.' : 'Dieser Ordner ist leer. Nach dem ersten Start liegen hier die Dateien deiner Welt.'}
        </p>
      ) : (
        <ul className="panel mt-3 divide-y divide-line">
          {entries.map((entry) => {
            const href =
              entry.type === 'dir'
                ? folderLink(entry.path)
                : entry.editable
                  ? `${base}?datei=${encodeURIComponent(entry.path)}`
                  : null
            const label = (
              <>
                {entry.type === 'dir' ? (
                  <Folder className="size-4 flex-none text-accent" aria-hidden />
                ) : (
                  <FileText className="size-4 flex-none text-ink-faint" aria-hidden />
                )}
                <span className="truncate font-mono text-[14px]">{entry.name}</span>
              </>
            )
            return (
              <li key={entry.path} className="flex items-center gap-3 pl-4 pr-2">
                {href ? (
                  <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 py-3 hover:text-accent">
                    {label}
                  </Link>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center gap-3 py-3 text-ink-faint" title="Zu groß zum Öffnen">
                    {label}
                  </span>
                )}
                <span className="hidden whitespace-nowrap text-[13px] text-ink-faint sm:block">
                  {formatRelative(entry.modifiedAt)}
                </span>
                <span className="w-[76px] whitespace-nowrap text-right text-[13px] text-ink-faint">
                  {entry.type === 'dir' ? 'Ordner' : formatBytes(entry.size)}
                </span>
                <DeleteEntry worldId={world.id} path={entry.path} name={entry.name} isFolder={entry.type === 'dir'} />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
