import path from 'node:path'

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if ((specifier.startsWith('.') || specifier.startsWith('/')) && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw error
  }
}
