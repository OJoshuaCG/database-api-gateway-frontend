import { describe, expect, it } from 'vitest'
import { profileCompatibility, profilesApplicableTo } from './engine-compat'

describe('profileCompatibility', () => {
  it('mysql y mariadb son la misma familia, no motores incompatibles (v21 §10)', () => {
    expect(profileCompatibility('mysql', 'mysql')).toBe('exact')
    expect(profileCompatibility('mysql', 'mariadb')).toBe('same-family')
    expect(profileCompatibility('mariadb', 'mysql')).toBe('same-family')
  })

  it('postgresql no comparte familia con ninguno de los dos', () => {
    expect(profileCompatibility('mysql', 'postgresql')).toBe('incompatible')
    expect(profileCompatibility('postgresql', 'mariadb')).toBe('incompatible')
  })
})

describe('profilesApplicableTo', () => {
  const profiles = [
    { id: 1, engine: 'mysql' as const },
    { id: 2, engine: 'mariadb' as const },
    { id: 3, engine: 'postgresql' as const },
  ]

  it('ofrece los de la familia, no solo los de engine idéntico', () => {
    // Filtrar por igualdad perdería el perfil mysql, que el backend SÍ puede aplicar a MariaDB
    // si todos sus privilegios existen en el catálogo real.
    expect(profilesApplicableTo(profiles, 'mariadb').map((p) => p.id)).toEqual([1, 2])
  })

  it('sin motor conocido no recorta nada', () => {
    expect(profilesApplicableTo(profiles, null)).toHaveLength(3)
  })
})
