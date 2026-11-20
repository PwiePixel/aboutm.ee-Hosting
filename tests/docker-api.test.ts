import './setup'
import { describe, expect, it } from 'vitest'
import { cleanOutput, demux } from '@/lib/runtime/docker-api'

function frame(channel: number, text: string): Buffer {
  const payload = Buffer.from(text)
  const header = Buffer.alloc(8)
  header[0] = channel
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, payload])
}

describe('Docker-Ausgabe', () => {
  it('setzt stdout und stderr aus Rahmen zusammen', () => {
    expect(demux(Buffer.concat([frame(1, 'Zeile 1\n'), frame(2, 'Fehler\n'), frame(1, 'Zeile 2\n')]))).toBe(
      'Zeile 1\nFehler\nZeile 2\n',
    )
  })

  it('lässt Ausgabe ohne Rahmen unverändert', () => {
    expect(demux(Buffer.from('einfach nur Text, kein Rahmen'))).toBe('einfach nur Text, kein Rahmen')
  })

  it('entfernt Farbcodes', () => {
    expect(cleanOutput('\u001b[32mgrün\u001b[0m und §aauch§r\r')).toBe('grün und auch')
  })
})
