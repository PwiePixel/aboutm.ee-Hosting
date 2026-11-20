'use server'

import { clientIp, currentUser } from '../auth'
import { db } from '../db'
import { newFeedbackId } from '../ids'
import { allowAttempt } from '../ratelimit'
import { turnstileProblem } from '../turnstile'
import { MESSAGE_MAX, normalizeEmail } from '../validation'
import type { ActionState } from './state'

const CATEGORIES = ['problem', 'feedback', 'kontakt']

export async function sendFeedbackAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const category = String(formData.get('category') ?? '')
  const rawEmail = String(formData.get('email') ?? '').trim()
  const message = String(formData.get('message') ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
  const values = { category, email: rawEmail.slice(0, 254), message: message.slice(0, MESSAGE_MAX) }
  const ip = await clientIp()

  if (!allowAttempt(`feedback:${ip ?? 'unbekannt'}`, 5, 60 * 60 * 1000)) {
    return { error: 'Du hast gerade mehrere Nachrichten geschickt. Versuch es später noch einmal.', values }
  }
  const check = await turnstileProblem(formData, ip)
  if (check) return { error: check, values }
  if (!CATEGORIES.includes(category)) return { error: 'Wähle, worum es geht.', values }

  let email: string | null = null
  if (rawEmail) {
    email = normalizeEmail(rawEmail)
    if (!email) return { error: 'Die E-Mail-Adresse sieht nicht richtig aus. Du kannst das Feld auch leer lassen.', values }
  }
  if (message.length < 10) return { error: 'Schreib uns ein paar Worte mehr, damit wir helfen können.', values }
  if (message.length > MESSAGE_MAX) return { error: `Die Nachricht darf höchstens ${MESSAGE_MAX} Zeichen haben.`, values }

  const user = await currentUser()
  db()
    .prepare('INSERT INTO feedback (id, category, email, message, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newFeedbackId(), category, email, message, user?.id ?? null, Date.now())

  return { ok: email ? 'Danke! Deine Nachricht ist angekommen. Wir melden uns per E-Mail.' : 'Danke! Deine Nachricht ist angekommen.' }
}
