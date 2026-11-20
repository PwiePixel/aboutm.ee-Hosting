import { config } from '../config'
import { dockerDriver } from './docker'
import { simulatedDriver } from './simulated'
import type { RuntimeDriver } from './types'

const drivers: Record<string, RuntimeDriver> = {
  simulated: simulatedDriver,
  docker: dockerDriver,
}

export function runtime(): RuntimeDriver {
  const driver = drivers[config.runtimeDriver]
  if (!driver) {
    throw new Error(
      `Unbekannter RUNTIME_DRIVER "${config.runtimeDriver}". Verfügbar: ${Object.keys(drivers).join(', ')}`,
    )
  }
  return driver
}
