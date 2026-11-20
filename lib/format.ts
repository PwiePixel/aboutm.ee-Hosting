const number = new Intl.NumberFormat('de-DE')
const oneDecimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const dateTime = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Berlin',
})

export function formatNumber(value: number): string {
  return number.format(value)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${oneDecimal.format(value)} ${units[unit]}`
}

export function formatMiBAsGiB(mib: number): string {
  return `${oneDecimal.format(mib / 1024)} GiB`
}

export function formatDateTime(timestamp: number): string {
  return `${dateTime.format(new Date(timestamp))} Uhr`
}

export function formatRelative(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return 'gerade eben'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `vor ${minutes} Min.`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? 'vor 1 Stunde' : `vor ${hours} Stunden`
  const days = Math.floor(hours / 24)
  if (days < 30) return days === 1 ? 'gestern' : `vor ${days} Tagen`
  return dateTime.format(new Date(timestamp))
}
