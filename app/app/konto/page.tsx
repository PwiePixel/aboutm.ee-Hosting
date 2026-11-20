import { ChevronLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ChangePasswordForm, DeleteAccountForm } from '@/components/account-forms'
import { requireUser } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'

export const metadata: Metadata = { title: 'Dein Konto' }

export default async function AccountPage() {
  const user = await requireUser()
  return (
    <>
      <Link href="/app" className="inline-flex items-center gap-1.5 text-[14px] text-ink-dim hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden />
        Deine Welten
      </Link>
      <h1 className="display mt-6 text-[clamp(36px,6vw,56px)]">Dein Konto.</h1>

      <section className="mt-10">
        <h2 className="eyebrow">Angemeldet als</h2>
        <dl className="panel mt-3 max-w-[560px] divide-y divide-line">
          <div className="flex justify-between gap-6 px-4 py-3 text-[14px]">
            <dt className="text-ink-dim">E-Mail</dt>
            <dd className="break-all text-right font-semibold">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-6 px-4 py-3 text-[14px]">
            <dt className="text-ink-dim">Konto seit</dt>
            <dd className="text-right font-semibold">{formatDateTime(user.created_at)}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-12">
        <h2 className="eyebrow">Passwort ändern</h2>
        <p className="mb-5 mt-2 text-[14px] text-ink-dim">Danach werden alle anderen Geräte abgemeldet.</p>
        <ChangePasswordForm />
      </section>

      <section className="mt-12 max-w-[560px] border border-danger-line bg-danger-wash p-5">
        <h2 className="eyebrow !text-danger">Konto löschen</h2>
        <p className="mb-5 mt-2 text-[14px] text-ink-dim">
          Löscht dein Konto mit allen Welten, Dateien und Backups. Das lässt sich nicht rückgängig machen.
        </p>
        <DeleteAccountForm />
      </section>
    </>
  )
}
