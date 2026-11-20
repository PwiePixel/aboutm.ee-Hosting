import type { Metadata } from 'next'
import { FeedbackForm } from '@/components/feedback-form'
import { currentUser } from '@/lib/auth'
import { config, turnstileEnabled } from '@/lib/config'

export const metadata: Metadata = { title: 'Feedback & Hilfe' }

export default async function HelpPage() {
  const user = await currentUser()
  return (
    <div className="wrap max-w-[680px] pt-14">
      <h1 className="display text-[clamp(36px,6vw,56px)]">Feedback &amp; Hilfe.</h1>
      <p className="mt-4 text-ink-dim">
        Etwas hakt, du hast eine Idee oder eine Frage? Schreib uns hier. Ein Konto brauchst du dafür nicht.
      </p>
      <div className="mt-10">
        <FeedbackForm siteKey={turnstileEnabled ? config.turnstileSiteKey : ''} email={user?.email ?? ''} />
      </div>
      {config.supportEmail && (
        <p className="mt-10 text-[14px] text-ink-dim">
          Lieber per E-Mail:{' '}
          <a href={`mailto:${config.supportEmail}`} className="link">
            {config.supportEmail}
          </a>
        </p>
      )}
    </div>
  )
}
