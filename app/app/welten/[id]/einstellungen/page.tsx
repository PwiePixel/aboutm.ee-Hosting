import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  DeleteWorld,
  GameSettingsForm,
  RenameForm,
  VersionForm,
  WhitelistEditor,
} from '@/components/world-settings'
import { requireUser } from '@/lib/auth'
import { config } from '@/lib/config'
import { formatMiBAsGiB } from '@/lib/format'
import { limits } from '@/lib/settings'
import { newerVersions } from '@/lib/versions'
import { getWorld, listWhitelist, worldAddress } from '@/lib/worlds'

export const metadata: Metadata = { title: 'Einstellungen' }

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="eyebrow">{title}</h2>
      <p className="mt-2 text-[14px] text-ink-dim">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const world = getWorld(user.id, (await params).id)
  if (!world) notFound()

  const online = world.status === 'online'
  const paused = world.status === 'paused'
  const upgrades = newerVersions(world.version).map((version) => version.id)
  const needsOnline = (
    <p className="text-[14px]">Starte die Welt und warte, bis sie online ist. Dann kannst du das hier ändern.</p>
  )

  const fixed: Array<[string, string]> = [
    ['Server-Software', `Paper ${world.version} · Build ${world.paper_build}`],
    ['Arbeitsspeicher', formatMiBAsGiB(config.ramMiB)],
    ['Speicherplatz', `${config.diskGiB} GiB`],
    ['Spielerplätze', String(config.maxPlayers)],
    ['Adresse', worldAddress(world)],
    ['Auto-Pause', `nach ${limits().autoPauseMinutes} min ohne Spieler`],
  ]

  return (
    <div>
      <Section title="Name" description="So heißt die Welt in deiner Übersicht.">
        <RenameForm worldId={world.id} name={world.name} />
      </Section>

      <Section
        title="Spieleinstellungen"
        description="Schwierigkeit und Spielmodus für eure Welt — ohne Konsolenbefehle."
      >
        {online ? (
          <GameSettingsForm
            worldId={world.id}
            gamemode={world.gamemode}
            difficulty={world.difficulty}
          />
        ) : (
          needsOnline
        )}
      </Section>

      <Section
        title="Whitelist"
        description="Wenn an, kommen nur Spieler auf der Liste rein. Bearbeiten kannst du sie, während deine Welt läuft."
      >
        {online ? (
          <WhitelistEditor
            worldId={world.id}
            enabled={world.whitelist_enabled === 1}
            players={listWhitelist(world.id)}
          />
        ) : (
          <>
            <p className="mb-2 text-[14px] text-ink-dim">
              Aktuell: <strong className="text-ink">{world.whitelist_enabled ? 'an' : 'aus'}</strong>
              {world.whitelist_enabled ? ` · ${listWhitelist(world.id).length} Spieler auf der Liste` : ''}
            </p>
            {needsOnline}
          </>
        )}
      </Section>

      <Section
        title="Minecraft-Version"
        description={`Diese Welt läuft mit Minecraft Java ${world.version}. Neustarts behalten diese Version; sie ändert sich nur, wenn du hier wechselst.`}
      >
        {upgrades.length === 0 ? (
          <p className="text-[14px]">Deine Welt läuft schon mit der neuesten Version.</p>
        ) : (
          <>
            <VersionForm worldId={world.id} options={upgrades} disabled={!paused} />
            <p className="hint">
              {paused
                ? 'Ein Wechsel geht nur nach oben und lässt sich nicht zurückdrehen. Mach vorher am besten ein Backup.'
                : 'Pausiere deine Welt, um die Version zu wechseln.'}
            </p>
          </>
        )}
      </Section>

      <Section title="Festgelegt" description="Diese Werte sind für alle Welten gleich.">
        <dl className="panel divide-y divide-line">
          {fixed.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-6 px-4 py-3 text-[14px]">
              <dt className="text-ink-dim">{label}</dt>
              <dd className="break-all text-right font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <section className="mt-10 border border-danger-line bg-danger-wash p-5">
        <h2 className="eyebrow !text-danger">Welt löschen</h2>
        <p className="mb-4 mt-2 text-[14px] text-ink-dim">
          Entfernt die Welt und alle ihre Daten unwiderruflich — auch Backups. Das lässt sich nicht rückgängig machen.
        </p>
        <DeleteWorld worldId={world.id} name={world.name} />
      </section>
    </div>
  )
}
