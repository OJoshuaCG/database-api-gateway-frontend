import { useSearchParams } from 'react-router-dom'
import { PageHeader, TabButton } from '@/components/ui'
import { ProjectsPanel } from '@/features/projects'
import { BlueprintsPanel } from '../components/BlueprintsPanel'

const TABS = ['proyectos', 'blueprints'] as const
type Tab = (typeof TABS)[number]

const isTab = (value: string | null): value is Tab => TABS.includes(value as Tab)

/**
 * Punto de entrada de los esquemas versionados, con dos pestañas.
 *
 * **«Proyectos» es la pestaña por defecto**, y esa es la decisión de fondo de la pantalla: un
 * proyecto es la unidad con la que se piensa el trabajo («las tiendas», «el CRM»), y desde ahí se
 * baja a los blueprints que agrupa. El catálogo plano sigue existiendo en la segunda pestaña
 * porque la pertenencia a un proyecto es **opcional**: la relación es N:M y un blueprint puede
 * estar en varios, en uno o en ninguno, así que sin la vista completa los huérfanos no tendrían
 * dónde verse.
 *
 * La pestaña vive en la URL (`?tab=`), igual que en `AdminPage` y `ServerDetailPage`: hace
 * enlazable «esta pantalla, en esta pestaña» y volver atrás no pierde dónde estabas. Un valor
 * desconocido cae en la pestaña por defecto en vez de dejar la página en blanco.
 */
export function DatabaseModelsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = isTab(tabParam) ? tabParam : 'proyectos'

  const setTab = (next: Tab) =>
    setSearchParams((params) => {
      if (next === 'proyectos') params.delete('tab')
      else params.set('tab', next)
      return params
    })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Blueprint schemas"
        description="Esquemas de base de datos versionados, y los proyectos que los agrupan."
      />

      <div role="tablist" className="flex items-center gap-1 border-b border-border">
        <TabButton active={tab === 'proyectos'} onClick={() => setTab('proyectos')}>
          Proyectos
        </TabButton>
        <TabButton active={tab === 'blueprints'} onClick={() => setTab('blueprints')}>
          Blueprints
        </TabButton>
      </div>

      {tab === 'proyectos' ? <ProjectsPanel /> : <BlueprintsPanel />}
    </div>
  )
}
