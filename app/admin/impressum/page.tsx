import Link from 'next/link'
import { ImprintForm } from '@/components/admin'
import { requireAdmin } from '@/lib/auth'
import { imprint, imprintComplete } from '@/lib/imprint'

export const dynamic = 'force-dynamic'

export default async function AdminImprintPage() {
  await requireAdmin()
  const data = imprint()
  return (
    <section>
      <h2 className="eyebrow">Angaben des Betreibers</h2>
      <p className="mt-2 max-w-[720px] text-[14px] text-ink-dim">
        Diese Angaben erscheinen im{' '}
        <Link href="/impressum" className="underline underline-offset-4 hover:text-ink">
          Impressum
        </Link>{' '}
        und in der{' '}
        <Link href="/datenschutz" className="underline underline-offset-4 hover:text-ink">
          Datenschutzerklärung
        </Link>
        . Wer in Deutschland eine Website betreibt, muss dort mit Name und ladungsfähiger Anschrift erreichbar sein.
      </p>
      {!imprintComplete(data) && (
        <p className="notice notice-error mt-4" role="status">
          <span>Das Impressum ist noch unvollständig — bitte vor dem Start ausfüllen.</span>
        </p>
      )}
      <div className="panel mt-4 p-5">
        <ImprintForm imprint={data} />
      </div>
    </section>
  )
}
