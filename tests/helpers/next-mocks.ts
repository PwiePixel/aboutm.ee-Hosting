import { vi } from 'vitest'

/**
 * Ersetzt die Teile von Next.js, die Server-Aktionen brauchen, damit sie sich direkt aufrufen lassen:
 * Kopfzeilen der Anfrage, Cookies und Weiterleitungen.
 */
export const requestHeaders = new Map<string, string>()
export const cookieJar = new Map<string, string>()

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => requestHeaders.get(name.toLowerCase()) ?? null }),
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  }),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
