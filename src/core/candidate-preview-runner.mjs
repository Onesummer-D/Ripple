import { writeSync } from 'node:fs'
import { createServer } from 'vite'
import config from './candidate-preview-vite.config.mjs'

let phase = 'module-load'
process.on('uncaughtExceptionMonitor', (error, origin) => writeSync(2, `Ripple candidate preview uncaught ${origin}: ${error.stack ?? error}\n`))
process.on('exit', code => writeSync(2, `Ripple candidate preview exited during ${phase} (code ${code})\n`))
phase = 'create-server'
console.log('Ripple candidate preview: creating Vite server')
const server = await createServer(config)
console.log('Ripple candidate preview: Vite server configured')
phase = 'listen'
await server.listen()
phase = 'listening'
console.log('Ripple candidate preview server is ready')

let closing = false
const close = () => {
  if (closing) return
  closing = true
  phase = 'shutdown'
  console.log('Ripple candidate preview: shutting down')
  void server.close().catch(error => {
    console.error('Ripple candidate preview shutdown failed', error)
    process.exitCode = 1
  })
}
process.once('SIGINT', close)
process.once('SIGTERM', close)
