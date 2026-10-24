import { Combobox } from '@/components/ui'
import type { ReleaseChannelOut } from '@/lib/contracts'
import { useReleaseChannelOptions } from '../hooks/use-release-channels'
import { releaseChannelModeLabel } from '../messages'

interface ReleaseChannelComboboxProps {
  /** Slug del canal elegido: es lo único que viaja al backend (`channel`). */
  value: string | null
  onChange: (slug: string | null) => void
  /** Permite no pedir el catálogo hasta que el selector esté realmente en pantalla. */
  enabled: boolean
  /** Cada pantalla resuelve el canal en un momento distinto, así que el aviso es suyo. */
  hint?: string
  error?: string
}

/**
 * Selector de canal de liberación para las pantallas que CONSUMEN uno (alta de base, aplicar
 * migraciones). Se controla por slug y no por objeto: así el valor sobrevive a un refetch del
 * catálogo y encaja tal cual en un campo de formulario.
 *
 * Muestra el modo junto al nombre porque el modo decide qué versión se va a resolver: `stable`
 * manual y `stable` derivado sirven cosas distintas aunque se llamen igual.
 */
export function ReleaseChannelCombobox({
  value,
  onChange,
  enabled,
  hint,
  error,
}: ReleaseChannelComboboxProps) {
  const releaseChannels = useReleaseChannelOptions(enabled)
  const channels = releaseChannels.data ?? []
  const selectedChannel = channels.find((channel) => channel.slug === value) ?? null

  return (
    <Combobox<ReleaseChannelOut>
      items={channels}
      value={selectedChannel}
      onChange={(channel) => onChange(channel?.slug ?? null)}
      itemToString={(channel) =>
        `${channel.name} (${channel.slug}) · ${releaseChannelModeLabel(channel.resolution_mode)}`
      }
      itemToKey={(channel) => channel.id}
      label="Canal"
      placeholder="Elegí un canal"
      isLoading={releaseChannels.isLoading}
      hint={hint}
      error={error}
    />
  )
}
