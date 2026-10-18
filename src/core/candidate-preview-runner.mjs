import { createServer } from 'vite'
import config from './candidate-preview-vite.config.mjs'

console.log('Ripple candidate preview: creating Vite server')
const server = await createServer(config)
console.log('Ripple candidate preview: Vite server configured')
await server.listen()
console.log('Ripple candidate preview server is ready')

let closing = false
const close = () => {
  if (closing) return
  closing = true
  void server.close().catch(error => {
    console.error('Ripple candidate preview shutdown failed', error)
    process.exitCode = 1
  })
}
process.once('SIGINT', close)
process.once('SIGTERM', close)
