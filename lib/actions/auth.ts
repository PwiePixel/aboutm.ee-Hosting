'use server'

import { redirect } from 'next/navigation'
import { clientIp, createSession, currentUser, destroyAllSessions, destroySession, requireUser } from '../auth'
import { db } from '../db'
import { newUserId } from '../ids'
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../password'
import { allowAttempt, isLimited } from '../ratelimit'
import { turnstileProblem } from '../turnstile'
import { normalizeEmail, passwordProblem } from '../validation'
import { deleteUserWithWorlds } from '../worlds'
import type { ActionState } from './state'

const TEN_MINUTES = 10 * 60 * 1000
const HOUR = 60 * 60 * 1000
const TOO_MANY = 'Zu viele Versuche. Warte ein paar Minuten und versuch es dann noch einmal.'

export async function registerAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  if (await currentUser()) redirect('/app')

  const rawEmail = String(formData.get('email') ?? '')
  const values = { email: rawEmail.slice(0, 254) }
  const ip = await clientIp()

  if (!allowAttempt(`register:${ip ?? 'unbekannt'}`, 5, HOUR)) return { error: TOO_MANY, values }
  const check = await turnstileProblem(formData, ip)
  if (check) return { error: check, values }

  const email = normalizeEmail(rawEmail)
  if (!email) return { error: 'Gib eine gültige E-Mail-Adresse ein.', values }
  const password = formData.get('password')
  const problem = passwordProblem(password)
  if (problem) return { error: problem, values }

  const existing = db().prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) return { error: 'Für diese E-Mail gibt es schon ein Konto. Melde dich stattdessen an.', values }

  const id = newUserId()
  const hash = await hashPassword(password as string)
  try {
    db()
      .prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(id, email, hash, Date.now())
  } catch {
    return { error: 'Für diese E-Mail gibt es schon ein Konto. Melde dich stattdessen an.', values }
  }
  await createSession(id)
  redirect('/app')
}

export async function loginAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  if (await currentUser()) redirect('/app')

  const rawEmail = String(formData.get('email') ?? '')
  const values = { email: rawEmail.slice(0, 254) }
  const ip = await clientIp()
  const email = normalizeEmail(rawEmail)
  const password = formData.get('password')

  if (!allowAttempt(`login:ip:${ip ?? 'unbekannt'}`, 30, TEN_MINUTES)) return { error: TOO_MANY, values }
  const check = await turnstileProblem(formData, ip)
  if (check) return { error: check, values }
  // Die Limits je Konto greifen erst nach bestandener Sicherheitsprüfung und zählen je Absender —
  // sonst könnte jeder ein fremdes Konto mit ein paar leeren Anfragen aussperren.
  if (email && !allowAttempt(`login:mail:${email}:${ip ?? 'unbekannt'}`, 8, TEN_MINUTES)) {
    return { error: TOO_MANY, values }
  }
  // Gegen verteiltes Durchprobieren: sehr viele Fehlversuche auf ein Konto, egal von wo.
  if (email && isLimited(`login:fail:${email}`, 60, HOUR)) return { error: TOO_MANY, values }

  const wrong: ActionState = { error: 'E-Mail oder Passwort stimmt nicht.', values }
  if (!email || typeof password !== 'string' || password.length === 0 || password.length > 200) return wrong

  const user = db().prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as
    | { id: string; password_hash: string }
    | undefined
  if (!user) {
    await verifyAgainstDummy(password)
    return wrong
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    allowAttempt(`login:fail:${email}`, 60, HOUR)
    return wrong
  }

  await createSession(user.id)
  redirect('/app')
}

export async function logoutAction(): Promise<void> {
  await destroySession()
  redirect('/')
}

export async function changePasswordAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  if (!allowAttempt(`password:${user.id}`, 8, TEN_MINUTES)) return { error: TOO_MANY }

  const current = formData.get('current')
  const next = formData.get('next')
  const row = db().prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string }
  if (typeof current !== 'string' || !(await verifyPassword(current, row.password_hash))) {
    return { error: 'Dein aktuelles Passwort stimmt nicht.' }
  }
  const problem = passwordProblem(next)
  if (problem) return { error: problem }

  db()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(await hashPassword(next as string), user.id)
  // Alle Geräte abmelden und dieses hier neu anmelden.
  destroyAllSessions(user.id)
  await createSession(user.id)
  return { ok: 'Dein Passwort ist geändert. Andere Geräte wurden abgemeldet.' }
}

export async function deleteAccountAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  if (!allowAttempt(`delete-account:${user.id}`, 8, TEN_MINUTES)) return { error: TOO_MANY }

  const password = formData.get('password')
  const row = db().prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string }
  if (typeof password !== 'string' || !(await verifyPassword(password, row.password_hash))) {
    return { error: 'Dein Passwort stimmt nicht.' }
  }

  await deleteUserWithWorlds(user.id)
  await destroySession()
  redirect('/?konto=geloescht')
}
