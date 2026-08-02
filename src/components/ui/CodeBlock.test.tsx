import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { CodeBlock } from './CodeBlock'

const SQL = "-- comentario\nSELECT id, nombre\nFROM ventas\nWHERE activo = 'S';"

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

/** `navigator` es un getter no escribible en jsdom: hay que redefinir la propiedad. */
function setClipboard(value: { writeText: (text: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true })
}

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
})

describe('CodeBlock', () => {
  it('muestra el SQL completo, sin perder ni una línea', () => {
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)
    const region = screen.getByRole('group', { name: 'SQL: Consulta' })
    expect(region.textContent).toContain('-- comentario')
    expect(region.textContent).toContain("WHERE activo = 'S';")
  })

  it('colorea cada tipo de token con su token del tema', () => {
    const { container } = renderWithProviders(<CodeBlock code={SQL} />)
    const keyword = Array.from(container.querySelectorAll('span')).find(
      (span) => span.textContent === 'SELECT',
    )
    const comment = Array.from(container.querySelectorAll('span')).find((span) =>
      span.textContent?.startsWith('-- comentario'),
    )
    expect(keyword?.className).toContain('text-syntax-keyword')
    expect(comment?.className).toContain('text-syntax-comment')
  })

  it('numera las líneas cuando hay más de una', () => {
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)
    expect(screen.getByText('4 línea(s)')).toBeInTheDocument()
    const region = screen.getByRole('group', { name: 'SQL: Consulta' })
    // La numeración es decorativa: se marca `aria-hidden` para no ensuciar el lector de pantalla.
    const gutter = region.querySelector('[aria-hidden]')
    expect(gutter?.textContent).toBe('1234')
  })

  it('omite la numeración en un fragmento de una sola línea', () => {
    renderWithProviders(<CodeBlock code="SELECT 1;" title="Uno" />)
    const region = screen.getByRole('group', { name: 'SQL: Uno' })
    expect(region.querySelector('[aria-hidden]')).toBeNull()
  })

  it('abre el visor a pantalla completa con el mismo SQL', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ver a pantalla completa' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Consulta')).toBeInTheDocument()
    expect(dialog.textContent).toContain('FROM ventas')
  })

  it('dentro del visor a pantalla completa ya no se ofrece expandir de nuevo', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)
    await user.click(screen.getByRole('button', { name: 'Ver a pantalla completa' }))

    // El botón que queda es el del bloque embebido, que sigue detrás del modal: solo uno.
    expect(screen.getAllByRole('button', { name: 'Ver a pantalla completa' })).toHaveLength(1)
  })

  it('copia el SQL al portapapeles', async () => {
    // `userEvent.setup()` instala su propio stub del portapapeles, así que el nuestro tiene que
    // definirse DESPUÉS para ganarle.
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })

    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)
    await user.click(screen.getAllByRole('button', { name: 'Copiar SQL' })[0]!)

    expect(writeText).toHaveBeenCalledWith(SQL)
    expect(await screen.findByText('SQL copiado al portapapeles')).toBeInTheDocument()
  })

  it('avisa en vez de romper si no hay portapapeles disponible', async () => {
    // Sin contexto seguro (HTTP sin TLS) `navigator.clipboard` no existe.
    const user = userEvent.setup()
    setClipboard(undefined)

    renderWithProviders(<CodeBlock code={SQL} />)
    await user.click(screen.getAllByRole('button', { name: 'Copiar SQL' })[0]!)

    expect(await screen.findByText('El portapapeles no está disponible')).toBeInTheDocument()
  })

  it('muestra el texto alternativo cuando no hay SQL', () => {
    renderWithProviders(<CodeBlock code="" emptyLabel="Sin rollback." />)
    expect(screen.getByText('Sin rollback.')).toBeInTheDocument()
  })

  it('renderiza las insignias que se le pasan junto al título', () => {
    renderWithProviders(<CodeBlock code={SQL} title="Rollback" extra={<span>confirmado</span>} />)
    expect(screen.getByText('confirmado')).toBeInTheDocument()
  })
})
