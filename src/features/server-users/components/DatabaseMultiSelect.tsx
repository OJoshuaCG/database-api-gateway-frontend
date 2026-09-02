import { useMemo, useState } from 'react'
import { Button, Callout, Checkbox, ErrorState, Input, Spinner } from '@/components/ui'
import { useServerDatabases } from '@/features/servers/hooks/use-introspection'
import { BULK_MAX_DATABASES } from './grant-logic'

interface DatabaseMultiSelectProps {
  serverId: number
  selected: string[]
  onChange: (databases: string[]) => void
  disabled?: boolean
  /** Tope de selección. Por defecto el del bulk de perfiles (v21 §11). */
  max?: number
}

/**
 * Elige una o varias bases del servidor 🔌.
 *
 * Reemplaza al campo de texto libre que había antes en las dos pantallas de permisos, y la
 * diferencia no es cosmética: tecleando el nombre no había forma de saber si existía hasta que
 * el motor devolvía un error, y un typo se leía como «el usuario no tiene permisos ahí». La
 * lista sale de `GET /servers/{id}/databases`, que es lo que el motor reporta **en vivo**, así
 * que incluye las bases no adoptadas — que es justo lo que hace falta acá: el otorgamiento
 * trabaja con nombres del motor, no con ids de inventario (v21 §11).
 *
 * Si la introspección falla o el motor no devuelve nada, cae a captura manual: un servidor
 * inalcanzable no debe bloquear la operación.
 */
export function DatabaseMultiSelect({
  serverId,
  selected,
  onChange,
  disabled = false,
  max = BULK_MAX_DATABASES,
}: DatabaseMultiSelectProps) {
  const databases = useServerDatabases(serverId, true)
  const [search, setSearch] = useState('')
  const [manualDraft, setManualDraft] = useState('')

  const selectedSet = useMemo(() => new Set(selected), [selected])

  // Las bases añadidas a mano (o que dejaron de existir en el motor) siguen siendo parte de la
  // selección: ocultarlas las borraría de la vista sin quitarlas del envío.
  const options = useMemo(() => {
    const fromEngine = databases.data ?? []
    const extra = selected.filter((name) => !fromEngine.includes(name))
    return [...fromEngine, ...extra]
  }, [databases.data, selected])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return options
    return options.filter((name) => name.toLowerCase().includes(term))
  }, [options, search])

  const atCapacity = selected.length >= max

  function toggle(name: string) {
    if (selectedSet.has(name)) {
      onChange(selected.filter((candidate) => candidate !== name))
    } else if (!atCapacity) {
      onChange([...selected, name])
    }
  }

  function selectVisible() {
    const merged = [...selected]
    for (const name of visible) {
      if (merged.length >= max) break
      if (!merged.includes(name)) merged.push(name)
    }
    onChange(merged)
  }

  function addManual() {
    const name = manualDraft.trim()
    if (!name || selectedSet.has(name) || atCapacity) return
    onChange([...selected, name])
    setManualDraft('')
  }

  if (databases.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Leyendo las bases del servidor…
      </div>
    )
  }

  const degraded = databases.isError || options.length === 0

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" disabled={disabled}>
      <legend className="text-sm font-medium text-foreground">Bases de datos destino</legend>

      {databases.isError && (
        <ErrorState
          error={databases.error}
          title="No se pudieron listar las bases del servidor"
          onRetry={() => void databases.refetch()}
        />
      )}

      {!degraded && (
        <>
          <Input
            aria-label="Buscar base de datos"
            placeholder="Buscar…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Seleccionadas: <strong className="text-foreground">{selected.length}</strong> de{' '}
              {options.length}
              {search.trim() && ` · ${visible.length} coinciden con el filtro`}
            </p>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <Button type="button" variant="ghost" size="sm" onClick={selectVisible}>
                {search.trim() ? `Todas las filtradas (${visible.length})` : 'Todas'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
                Ninguna
              </Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
              Ninguna base coincide con «{search.trim()}».
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {visible.map((name) => {
                const checked = selectedSet.has(name)
                return (
                  <li key={name} className="px-3 py-2 hover:bg-surface-muted">
                    <Checkbox
                      label={name}
                      checked={checked}
                      // El tope es del endpoint, no una preferencia: por encima de él la llamada
                      // se rechazaría entera, así que se frena antes de marcar la base 101.
                      disabled={!checked && atCapacity}
                      onChange={() => toggle(name)}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {atCapacity && (
        <Callout tone="warning" title={`Llegaste al tope de ${max} bases`}>
          Es el máximo que acepta una aplicación de perfil. Aplicá este lote y repetí con el resto.
        </Callout>
      )}

      {degraded && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {databases.isError
              ? 'No se pudo consultar el servidor; escribí el nombre de cada base a mano.'
              : 'El servidor no reportó bases de datos; escribí el nombre de cada base a mano.'}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <Input
                aria-label="Nombre de la base de datos"
                placeholder="app_prod"
                value={manualDraft}
                onChange={(event) => setManualDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addManual()
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={addManual}
              disabled={!manualDraft.trim() || atCapacity}
            >
              Añadir
            </Button>
          </div>
          {selected.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {selected.map((name) => (
                <li key={name}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toggle(name)}
                    aria-label={`Quitar ${name} de la selección`}
                  >
                    {name} ✕
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!degraded && (
        <p className="text-xs text-muted-foreground">
          Salen del motor en vivo 🔌: la lista incluye las bases que el gateway todavía no adoptó.
        </p>
      )}
    </fieldset>
  )
}
