import { AdminDeleteFeedback } from '@/components/admin'
import { adminFeedback } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

const CATEGORY: Record<string, string> = { problem: 'Problem', feedback: 'Feedback', kontakt: 'Kontakt' }

export default async function AdminFeedbackPage() {
  await requireAdmin()
  const messages = adminFeedback()
  if (messages.length === 0) {
    return (
      <p className="panel px-4 py-7 text-center text-[14px] text-ink-dim">
        Noch keine Nachrichten. Was über „Feedback &amp; Hilfe“ geschickt wird, landet hier.
      </p>
    )
  }
  return (
    <ul className="space-y-4">
      {messages.map((message) => (
        <li key={message.id} className="panel p-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-[13px] text-ink-dim">
              <span className="mr-2 bg-panel-2 px-2 py-1 font-mono text-[11px] font-bold uppercase text-ink">
                {CATEGORY[message.category] ?? message.category}
              </span>
              {formatDateTime(message.createdAt)} ·{' '}
              {message.email ? (
                <a href={`mailto:${message.email}`} className="link">
                  {message.email}
                </a>
              ) : (
                'anonym'
              )}
            </p>
            <AdminDeleteFeedback feedbackId={message.id} />
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-[15px]">{message.message}</p>
        </li>
      ))}
    </ul>
  )
}
