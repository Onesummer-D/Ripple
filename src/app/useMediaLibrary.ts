import { useEffect, useState } from 'react'
import { listMediaResources, readImage, saveMediaResource, type MediaResource } from '../adapters/mediaLibrary'

export function useMediaLibrary() {
  const [resources, setResources] = useState<Record<string, MediaResource>>({})
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    listMediaResources().then((items) => {
      if (active) setResources((current) => ({ ...Object.fromEntries(items.map((item) => [item.id, item])), ...current }))
    }).catch((cause: Error) => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [])
  const importImage = async (file: File) => {
    const resource = await readImage(file)
    await saveMediaResource(resource)
    setResources((current) => ({ ...current, [resource.id]: resource }))
    setError(undefined)
    return resource
  }
  return { resources, error, importImage }
}
