import type { Metadata } from 'next'
import { WorldConsole } from '@/components/world-console'

export const metadata: Metadata = { title: 'Konsole' }

export default function ConsolePage() {
  return <WorldConsole />
}
