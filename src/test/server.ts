import { setupServer } from 'msw/node'

/** Servidor MSW compartido. Cada test añade sus handlers con `server.use(...)`. */
export const server = setupServer()
