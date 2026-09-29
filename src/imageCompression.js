// Keep notation readable while limiting the size and memory cost of uploads.
export async function compressScoreImage(file) {
  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('无法读取这张图片。'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }

  const width = image.naturalWidth
  const height = image.naturalHeight
  if (!width || !height) throw new Error('图片尺寸无效。')
  const scale = Math.min(1, 6000 / Math.max(width, height), Math.sqrt(12_000_000 / (width * height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法处理这张图片。')
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.92))
  canvas.width = 0
  canvas.height = 0

  if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file
  const baseName = file.name.replace(/\.[^.]+$/, '') || '曲谱'
  return new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() })
}

