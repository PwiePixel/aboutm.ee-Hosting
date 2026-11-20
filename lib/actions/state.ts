/** Rückgabe einer Formular-Aktion: Fehlermeldung, Erfolgshinweis und die zuletzt eingegebenen Werte. */
export type ActionState = {
  error?: string
  ok?: string
  values?: Record<string, string>
}

export const EMPTY: ActionState = {}
