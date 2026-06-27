import { useState } from 'react'
import { Badge, Button, Combobox, Input, Switch } from '@/components/ui'
import type { EngineType, GrantLevel, ObjectRef, ServerUserOut } from '@/lib/contracts'
import { PrivilegeMultiSelect, grantLevelsForEngine } from '@/features/privileges'
import { useCheckGrantable } from '@/features/servers/hooks/use-grantable'
import { useGrantPrivileges, useRevokePrivileges } from '../hooks/use-user-grants'

interface GrantManagerProps {
  user: ServerUserOut
  engine: EngineType | null
}

const LEVELS_WITH_DATABASE: GrantLevel[] = [
  'database',
  'schema',
  'table',
  'column',
  'sequence',
  'routine',
]
const LEVELS_WITH_SCHEMA: GrantLevel[] = ['schema', 'table', 'column', 'sequence', 'routine']
const LEVELS_WITH_TABLE: GrantLevel[] = ['table', 'column']
const ROUTINE_KINDS: ('FUNCTION' | 'PROCEDURE')[] = ['FUNCTION', 'PROCEDURE']

/** Otorga o revoca privilegios de un usuario a un nivel/objeto (§7). Toca el motor 🔌. */
export function GrantManager({ user, engine }: GrantManagerProps) {
  const isPg = engine === 'postgresql'
  const levelOptions = grantLevelsForEngine(engine)

  const [action, setAction] = useState<'grant' | 'revoke'>('grant')
  const [level, setLevel] = useState<GrantLevel>('database')
  const [database, setDatabase] = useState('')
  const [schema, setSchema] = useState('public')
  const [table, setTable] = useState('')
  const [columns, setColumns] = useState('')
  const [sequence, setSequence] = useState('')
  const [routineKind, setRoutineKind] = useState<'FUNCTION' | 'PROCEDURE'>('FUNCTION')
  const [routineName, setRoutineName] = useState('')
  const [privileges, setPrivileges] = useState<string[]>([])
  const [withGrantOption, setWithGrantOption] = useState(false)
  const [cascade, setCascade] = useState(false)
  const [confirmGrantee, setConfirmGrantee] = useState('')

  const grant = useGrantPrivileges(user.id)
  const revoke = useRevokePrivileges(user.id)
  const grantable = useCheckGrantable(user.server_id)

  function buildObjectRef(): ObjectRef {
    const ref: ObjectRef = {}
    if (LEVELS_WITH_DATABASE.includes(level) && database.trim()) ref.database = database.trim()
    if (isPg && LEVELS_WITH_SCHEMA.includes(level) && schema.trim()) ref.schema = schema.trim()
    if (LEVELS_WITH_TABLE.includes(level) && table.trim()) ref.table = table.trim()
    if (level === 'column' && columns.trim()) {
      ref.columns = columns
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean)
    }
    if (level === 'sequence' && sequence.trim()) ref.sequence = sequence.trim()
    if (level === 'routine' && routineName.trim()) {
      ref.routine = { kind: routineKind, name: routineName.trim() }
    }
    return ref
  }

  const hasPrivileges = privileges.length > 0
  const cascadeNeedsConfirm = action === 'revoke' && cascade && confirmGrantee !== user.username
  const canSubmit = hasPrivileges && !cascadeNeedsConfirm
  const isPending = grant.isPending || revoke.isPending

  function handleSubmit() {
    const objectRef = buildObjectRef()
    if (action === 'grant') {
      grant.mutate({
        level,
        object_ref: objectRef,
        privileges,
        with_grant_option: withGrantOption,
      })
    } else {
      revoke.mutate({
        body: { level, object_ref: objectRef, privileges, cascade: cascade || undefined },
        confirmGrantee: cascade ? confirmGrantee : undefined,
      })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={action === 'grant' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setAction('grant')}
        >
          Otorgar
        </Button>
        <Button
          type="button"
          variant={action === 'revoke' ? 'danger' : 'outline'}
          size="sm"
          onClick={() => setAction('revoke')}
        >
          Revocar
        </Button>
      </div>

      <div className="w-full sm:max-w-xs">
        <Combobox
          items={levelOptions}
          value={levelOptions.find((option) => option.value === level) ?? null}
          onChange={(option) => setLevel(option?.value ?? 'database')}
          itemToString={(option) => option.label}
          itemToKey={(option) => option.value}
          label="Nivel"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {LEVELS_WITH_DATABASE.includes(level) && (
          <Input
            label="Base de datos"
            value={database}
            onChange={(event) => setDatabase(event.target.value)}
          />
        )}
        {isPg && LEVELS_WITH_SCHEMA.includes(level) && (
          <Input
            label="Esquema"
            hint="PostgreSQL; default «public»."
            value={schema}
            onChange={(event) => setSchema(event.target.value)}
          />
        )}
        {LEVELS_WITH_TABLE.includes(level) && (
          <Input
            label="Tabla"
            value={table}
            onChange={(event) => setTable(event.target.value)}
          />
        )}
        {level === 'column' && (
          <Input
            label="Columnas"
            hint="Separadas por coma."
            value={columns}
            onChange={(event) => setColumns(event.target.value)}
          />
        )}
        {level === 'sequence' && (
          <Input
            label="Secuencia"
            value={sequence}
            onChange={(event) => setSequence(event.target.value)}
          />
        )}
        {level === 'routine' && (
          <>
            <Combobox
              items={ROUTINE_KINDS}
              value={routineKind}
              onChange={(value) => setRoutineKind(value ?? 'FUNCTION')}
              itemToString={(value) => value}
              itemToKey={(value) => value}
              label="Tipo de rutina"
            />
            <Input
              label="Nombre de la rutina"
              value={routineName}
              onChange={(event) => setRoutineName(event.target.value)}
            />
          </>
        )}
      </div>

      <PrivilegeMultiSelect engine={engine} value={privileges} onChange={setPrivileges} />

      {action === 'grant' ? (
        <div className="flex flex-col gap-3">
          <Switch
            checked={withGrantOption}
            onCheckedChange={setWithGrantOption}
            label="WITH GRANT OPTION"
            hint="Permite al usuario re-delegar estos privilegios."
          />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              isLoading={grantable.isPending}
              disabled={!hasPrivileges}
              onClick={() =>
                grantable.mutate({ level, object_ref: buildObjectRef(), privileges })
              }
            >
              Comprobar delegación
            </Button>
            {grantable.data && (
              <Badge tone={grantable.data.can_grant ? 'success' : 'error'}>
                {grantable.data.can_grant ? 'El gateway puede delegar' : 'El gateway NO puede delegar'}
              </Badge>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {isPg && (
            <Switch
              checked={cascade}
              onCheckedChange={setCascade}
              label="CASCADE (PostgreSQL)"
              hint="Revoca también los privilegios re-delegados. Exige confirmar el usuario."
            />
          )}
          {cascade && (
            <Input
              label={`Escribe «${user.username}» para confirmar el CASCADE`}
              value={confirmGrantee}
              onChange={(event) => setConfirmGrantee(event.target.value)}
              autoComplete="off"
            />
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          variant={action === 'revoke' ? 'danger' : 'primary'}
          onClick={handleSubmit}
          disabled={!canSubmit}
          isLoading={isPending}
        >
          {action === 'grant' ? 'Otorgar privilegios' : 'Revocar privilegios'}
        </Button>
      </div>
    </div>
  )
}
