import { ArrowRight, Check, Plus } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { imageUrl } from '@/lib/art'
import { currentUser } from '@/lib/auth'
import { config } from '@/lib/config'
import { formatMiBAsGiB, formatNumber } from '@/lib/format'
import { limits } from '@/lib/settings'
import { playHeadline, totals } from '@/lib/stats'
import { RECOMMENDED_VERSION, VERSIONS } from '@/lib/versions'
import { slotsFree } from '@/lib/worlds'

const STEPS = [
  { title: 'Welt anlegen', text: 'Name eintippen, Minecraft-Version aussuchen. Mehr brauchst du nicht.' },
  { title: 'Starten', text: 'Sobald ein Serverplatz frei ist, fährt deine Welt hoch.' },
  { title: 'Adresse teilen', text: 'Mit einem Klick kopiert — ab damit in den Gruppenchat.' },
  { title: 'Spielen', text: 'In Minecraft verbinden und zusammen loslegen.' },
]

export default async function HomePage({ searchParams }: { searchParams: Promise<{ konto?: string }> }) {
  const [user, params] = await Promise.all([currentUser(), searchParams])
  const limit = limits()
  const free = slotsFree()
  const ram = formatMiBAsGiB(config.ramMiB)
  const stats = totals()
  const headline = playHeadline(stats.playMs)
  const oldest = VERSIONS.at(-1)!.id
  const cta = user ? '/app' : '/register'
  const hero = imageUrl('hero')

  const included = [
    'Paper für Minecraft Java',
    `${ram} Arbeitsspeicher`,
    `${config.diskGiB} GiB für eure Welt`,
    `Bis zu ${config.maxPlayers} Spieler`,
    'Konsole im Browser',
    'Backups zum Zurückspringen',
    'Dateien direkt bearbeiten',
    'Whitelist für eure Runde',
  ]

  const faq = [
    {
      q: 'Was für Server kann ich erstellen?',
      a: `Paper-Server für Minecraft Java. Die Version suchst du beim Anlegen aus — von ${oldest} bis ${VERSIONS[0]!.id}, empfohlen ist gerade ${RECOMMENDED_VERSION.id}. Forge, Fabric und Bedrock gibt es hier im Moment nicht.`,
    },
    {
      q: 'Was passiert mit meiner Welt, wenn keiner spielt?',
      a: `Ist ${limit.autoPauseMinutes} Minuten lang niemand online, speichern wir die Welt und pausieren den Server. Beim nächsten Start ist alles wieder da, wo ihr aufgehört habt.`,
    },
    {
      q: 'Wie kommen meine Freunde auf den Server?',
      a: 'Jede Welt hat eine eigene Adresse. Kopier sie in der Übersicht und schick sie deinen Freunden. In Minecraft Java tragen sie die Adresse unter „Mehrspieler“ ein — fertig.',
    },
    {
      q: 'Wie viele Welten und Spieler sind drin?',
      a: `Pro Konto bis zu ${limit.maxWorldsPerUser} Welten, eine davon kann gleichzeitig laufen. Voreingestellt sind ${config.maxPlayers} Spielerplätze. Wie viele wirklich flüssig zusammen spielen, hängt von eurer Welt und eurer Spielweise ab.`,
    },
    {
      q: 'Wie viel Leistung hat eine Welt?',
      a: `Jede laufende Welt bekommt ${ram} Arbeitsspeicher. Den Prozessor teilen sich die Welten, die gerade laufen. Pausierte Welten verbrauchen keine Rechenleistung.`,
    },
    {
      q: 'Gibt es Backups?',
      a: `Ja. Du kannst jederzeit selbst ein Backup anlegen (bis zu ${config.maxManualBackups}). Zusätzlich lässt sich einschalten, dass nach jedem Pausieren automatisch gesichert wird — davon behalten wir die letzten ${config.maxAutoBackups}. Ein Backup wiederherzustellen ersetzt die aktuelle Welt.`,
    },
    {
      q: 'Kann ich Plugins oder eine eigene Welt hochladen?',
      a: 'Im Moment nicht. Du startest mit einer frischen Welt, wenn du magst mit eigenem Seed. Textdateien wie die server.properties kannst du im Browser bearbeiten.',
    },
  ]

  return (
    <>
      {params.konto === 'geloescht' && (
        <div className="wrap pt-6">
          <p className="notice" role="status">
            <Check aria-hidden />
            <span>Dein Konto und alle deine Welten sind gelöscht.</span>
          </p>
        </div>
      )}

      {/* Einstieg */}
      <section className="wrap pt-14 sm:pt-20">
        <p className="eyebrow text-accent">Minecraft Java · Paper</p>
        <h1 className="display mt-5 text-[clamp(40px,8.6vw,92px)]">
          Euer Server.
          <br />
          <span className="text-accent">Kostenlos.</span>
        </h1>
        <p className="mt-6 max-w-[560px] text-[18px] text-ink-dim">
          Leg eine Welt an, schick deinen Freunden die Adresse und spielt zusammen. Um Starten, Speichern und Pausieren
          kümmern wir uns.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link href={cta} className="btn btn-primary btn-lg max-sm:w-full max-sm:whitespace-normal max-sm:py-3 max-sm:text-center max-sm:leading-snug">
            <Plus aria-hidden />
            Kostenlosen Server erstellen
          </Link>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-ink-dim">
            {['Kostenlos', 'Welt bleibt gespeichert', `Auto-Pause nach ${limit.autoPauseMinutes} Min`].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <Check className="size-4 text-accent" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-12 border border-line">
          <Image
            src={hero}
            alt="Minecraft-Landschaft: eine ruhige Bucht mit bewaldeter Küste unter blauem Himmel"
            width={960}
            height={420}
            priority
            unoptimized
            className="block aspect-[16/7] w-full object-cover"
          />
        </div>
        <p className="mt-4 text-center text-[14px] text-ink-dim" aria-live="polite">
          Gerade {free === 1 ? 'ist' : 'sind'} <strong className="text-ink">{free}</strong> von {limit.totalSlots}{' '}
          Serverplätzen frei.
        </p>
      </section>

      {/* Zahlen — live aus der Statistik */}
      <section className="wrap mt-24">
        <div className="panel p-7 sm:p-10">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="display text-[clamp(36px,6.4vw,68px)]">
                {headline.prefix && <span className="text-ink-dim">{headline.prefix} </span>}
                {headline.value} <span className="text-accent">{headline.unit}.</span>
              </p>
              <p className="mt-3 text-ink-dim">Von echten Spielern auf echten Servern.</p>
            </div>
            <Link href="/zahlen" className="btn">
              Alle Zahlen ansehen
              <ArrowRight aria-hidden />
            </Link>
          </div>
          <dl className="mt-8 grid gap-px border border-line bg-line sm:grid-cols-3">
            {[
              { value: stats.worldsCreated, label: 'Server erstellt' },
              { value: stats.starts, label: 'Server-Starts' },
              { value: stats.peakPlayers, label: 'Spieler gleichzeitig' },
            ].map((figure) => (
              <div key={figure.label} className="bg-base p-5">
                <dd className="display text-[34px]">{formatNumber(figure.value)}</dd>
                <dt className="mt-1 text-[14px] text-ink-dim">{figure.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Ablauf */}
      <section id="ablauf" className="wrap mt-24 scroll-mt-8">
        <h2 className="display text-[clamp(30px,5vw,52px)]">In vier Schritten im Spiel.</h2>
        <ol className="mt-10 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="bg-base-soft p-6">
              <p className="font-mono text-[13px] font-semibold text-accent">{String(index + 1).padStart(2, '0')}</p>
              <h3 className="heading mt-6 text-[19px]">{step.title}</h3>
              <p className="mt-2 text-[14px] text-ink-dim">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Umfang */}
      <section className="wrap mt-24 grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <div>
          <h2 className="display text-[clamp(30px,5vw,52px)]">Alles auf einer Seite.</h2>
          <p className="mt-5 max-w-[440px] text-[16px] text-ink-dim">
            Starten, pausieren, Adresse kopieren, Status sehen. Die Technik dahinter musst du nicht kennen — du siehst
            deine Welt, nicht den Maschinenraum.
          </p>
        </div>
        <ul className="grid gap-px self-start border border-line bg-line sm:grid-cols-2">
          {included.map((item) => (
            <li key={item} className="flex items-center gap-3 bg-base-soft px-5 py-4 text-[15px]">
              <Check className="size-4 flex-none text-accent" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Warum kostenlos funktioniert */}
      <section className="wrap mt-24">
        <div className="panel grid gap-8 p-7 sm:p-10 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
          <h2 className="display text-[clamp(28px,4.4vw,46px)]">
            Kostenlos,
            <br />
            aber <span className="text-accent">fair geteilt.</span>
          </h2>
          <div className="space-y-4 text-[15px] text-ink-dim">
            <p>
              Eine pausierte Welt belegt keinen Server. Gespeichert bleibt sie trotzdem vollständig — Rechenleistung
              bekommt sie in dem Moment, in dem du sie startest.
            </p>
            <p>
              Es laufen höchstens {limit.totalSlots} Welten gleichzeitig. Sind alle Plätze belegt, stellt sich dein
              Start in eine Warteschlange, statt dass alle Server langsamer werden. Nach {limit.autoPauseMinutes}{' '}
              Minuten ohne Spieler macht eine Welt von selbst Platz.
            </p>
            <p>
              Gedacht ist aboutm.ee für kleine Runden unter Freunden — nicht für große Netzwerke, schwere Modpacks oder
              hundert Spieler auf einmal.
            </p>
          </div>
        </div>
      </section>

      {/* Fragen */}
      <section className="wrap mt-24 grid gap-8 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
        <h2 className="display text-[clamp(30px,5vw,52px)]">Kurz gefragt.</h2>
        <div className="border-t border-line">
          {faq.map((entry) => (
            <details key={entry.q} className="group border-b border-line">
              <summary className="flex list-none items-center justify-between gap-4 py-4 text-[16px] font-semibold [&::-webkit-details-marker]:hidden">
                {entry.q}
                <Plus className="size-4 flex-none text-ink-faint transition-transform group-open:rotate-45" aria-hidden />
              </summary>
              <p className="max-w-[620px] pb-5 text-[15px] text-ink-dim">{entry.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Abschluss */}
      <section className="wrap mt-24">
        <div className="flex flex-wrap items-center justify-between gap-6 border border-accent bg-accent-wash p-7 sm:p-10">
          <h2 className="display text-[clamp(28px,4.6vw,48px)]">Heute Abend zocken?</h2>
          <Link href={cta} className="btn btn-primary btn-lg">
            <Plus aria-hidden />
            Welt erstellen
          </Link>
        </div>
      </section>
    </>
  )
}
