import type { MediaAssetMetadata } from '../domain/contracts'

export interface MediaResource extends MediaAssetMetadata {
  dataUrl: string
}

export const mediaReference = (id: string) => `media://${id}`

export const readImage = async (file: File): Promise<MediaResource> => {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片')
  if (file.size > 8 * 1024 * 1024) throw new Error('请选择 8 MB 以内的图片')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择'))
    reader.readAsDataURL(file)
  })
  const image = new Image()
  image.src = dataUrl
  await image.decode().catch(() => { throw new Error('图片无法解码，请选择有效图片') })
  return { id: crypto.randomUUID(), name: file.name, mimeType: file.type, bytes: file.size, width: image.naturalWidth, height: image.naturalHeight, dataUrl }
}

const openLibrary = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('ripple-media', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('resources', { keyPath: 'id' })
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(new Error('本地图片库无法打开'))
})

export const saveMediaResource = async (resource: MediaResource): Promise<void> => {
  const db = await openLibrary()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('resources', 'readwrite')
      transaction.objectStore('resources').put(resource)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('图片保存失败，请检查本地存储空间'))
      transaction.onabort = () => reject(new Error('图片保存被中止'))
    })
  } finally { db.close() }
}

export const listMediaResources = async (): Promise<MediaResource[]> => {
  const db = await openLibrary()
  try {
    return await new Promise<MediaResource[]>((resolve, reject) => {
      const request = db.transaction('resources').objectStore('resources').getAll()
      request.onsuccess = () => resolve(request.result as MediaResource[])
      request.onerror = () => reject(new Error('图片库读取失败'))
    })
  } finally { db.close() }
}
