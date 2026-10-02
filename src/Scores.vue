<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { compressScoreImage } from './imageCompression'
import { scoreBucket, supabase } from './supabase'

const scores = ref([])
const pageSize = 10
const currentPage = ref(1)
const scoreTotal = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(scoreTotal.value / pageSize)))
const pageNumbers = computed(() => {
  const start = Math.max(1, Math.min(currentPage.value - 2, totalPages.value - 4))
  return Array.from({ length: Math.min(5, totalPages.value - start + 1) }, (_, index) => start + index)
})
let listRequest = 0
const loading = ref(false)
const listError = ref('')
const user = ref(null)
const isAdmin = ref(false)
const showLogin = ref(false)
const email = ref('')
const password = ref('')
const loginBusy = ref(false)
const loginError = ref('')
const uploadBusy = ref(false)
const uploadStep = ref('')
const uploadError = ref('')
const uploadSuccess = ref('')
const title = ref('')
const composer = ref('')
const file = ref(null)
const pasteZone = ref(null)
const selected = ref(null)
const imageStage = ref(null)
const imageElement = ref(null)
const imageZoom = ref(1)
const imageFullscreen = ref(false)
const imageOffset = ref({ x: 0, y: 0 })
const previewError = ref('')
const previewBusy = ref(false)
const musicContainer = ref(null)
let authSubscription
let previewRequest = 0
let imageDrag = null
let suppressZoomClick = false
let previousBodyOverflow = ''

const acceptedTypes = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  musicxml: 'application/vnd.recordare.musicxml+xml',
  xml: 'application/xml',
}
const clipboardExtensions = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/vnd.recordare.musicxml+xml': 'musicxml',
}
const extensionOf = name => name.split('.').at(-1)?.toLowerCase() || ''
const fileKind = row => ['png', 'jpg', 'jpeg', 'webp'].includes(row.file_type) ? 'image' : row.file_type === 'pdf' ? 'pdf' : 'musicxml'
const publicUrl = row => supabase?.storage.from(scoreBucket).getPublicUrl(row.storage_path).data.publicUrl || ''
const selectedUrl = computed(() => selected.value ? publicUrl(selected.value) : '')
const dateLabel = date => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date))

async function loadScores() {
  if (!supabase) return
  const request = ++listRequest
  loading.value = true
  listError.value = ''
  const from = (currentPage.value - 1) * pageSize
  const { data, error, count } = await supabase.from('scores')
    .select('id,title,composer,storage_path,file_type,created_at', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(from, from + pageSize - 1)
  if (request !== listRequest) return
  if (error) listError.value = '曲谱暂时无法加载，请稍后刷新重试。'
  else {
    scoreTotal.value = count ?? 0
    if (currentPage.value > totalPages.value) { currentPage.value = totalPages.value; return loadScores() }
    scores.value = data || []
  }
  loading.value = false
}

function goToPage(page) {
  if (page < 1 || page > totalPages.value || page === currentPage.value) return
  currentPage.value = page
  loadScores()
}

async function refreshIdentity() {
  if (!supabase) return
  const { data, error } = await supabase.auth.getUser()
  user.value = error ? null : data.user
  isAdmin.value = false
  if (user.value) {
    const { data: admin, error: roleError } = await supabase.from('score_admins').select('id').eq('id', user.value.id).maybeSingle()
    isAdmin.value = !roleError && !!admin
  }
}

async function signIn() {
  if (!supabase) return
  loginBusy.value = true
  loginError.value = ''
  const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value })
  password.value = ''
  if (error) loginError.value = '登录失败，请检查邮箱和密码。'
  else {
    await refreshIdentity()
    showLogin.value = !isAdmin.value
    if (!isAdmin.value) loginError.value = '此账号没有曲谱管理权限。'
  }
  loginBusy.value = false
}

async function signOut() {
  await supabase?.auth.signOut()
  user.value = null
  isAdmin.value = false
}

function setUploadFile(nextFile) {
  file.value = nextFile
  uploadError.value = ''
  uploadSuccess.value = ''
  if (file.value && !title.value.trim()) title.value = file.value.name.replace(/\.[^.]+$/, '').slice(0, 120)
}

function chooseFile(event) {
  setUploadFile(event.target.files?.[0] || null)
}

function handlePaste(event) {
  if (!isAdmin.value) return
  const inPasteZone = event.target === pasteZone.value
  if (!inPasteZone && event.target?.closest?.('input, textarea, [contenteditable]')) return

  const clipboard = event.clipboardData
  const copiedFiles = Array.from(clipboard?.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter(Boolean)
  const candidates = copiedFiles.length ? copiedFiles : Array.from(clipboard?.files || [])
  const copied = candidates.find(item => acceptedTypes[extensionOf(item.name)] || clipboardExtensions[item.type])
  if (copied) {
    const ext = acceptedTypes[extensionOf(copied.name)] ? extensionOf(copied.name) : clipboardExtensions[copied.type]
    const name = acceptedTypes[extensionOf(copied.name)] ? copied.name : `粘贴曲谱-${new Date().toISOString().slice(0, 10)}.${ext}`
    const normalized = new File([copied], name, { type: acceptedTypes[ext], lastModified: Date.now() })
    event.preventDefault()
    setUploadFile(normalized)
    return
  }

  const pastedText = clipboard?.getData('text/plain')?.trim() || ''
  if (/<score-(partwise|timewise)\b/i.test(pastedText)) {
    event.preventDefault()
    setUploadFile(new File([pastedText], `粘贴曲谱-${new Date().toISOString().slice(0, 10)}.musicxml`, { type: acceptedTypes.musicxml }))
    return
  }
  if (inPasteZone) {
    event.preventDefault()
    uploadError.value = candidates.length ? '剪贴板中的文件格式不受支持。' : '剪贴板中没有可上传的曲谱图片、文件或 MusicXML 内容。'
  }
}

async function uploadScore() {
  if (!supabase || !isAdmin.value || uploadBusy.value) return
  uploadError.value = ''
  uploadSuccess.value = ''
  if (!file.value) { uploadError.value = '请先选择或粘贴曲谱文件。'; return }
  const name = title.value.trim()
  const ext = extensionOf(file.value.name)
  if (!name || name.length > 120) { uploadError.value = '请输入不超过 120 个字的曲谱标题。'; return }
  if (!acceptedTypes[ext]) { uploadError.value = '支持 PDF、PNG、JPG、WebP、MusicXML 和 XML 文件。'; return }
  const original = file.value
  const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext)
  if (!isImage && original.size > 15 * 1024 * 1024) { uploadError.value = '单个文件不能超过 15 MB。'; return }
  uploadBusy.value = true
  try {
    uploadStep.value = isImage ? 'compressing' : 'uploading'
    const prepared = isImage ? await compressScoreImage(original) : original
    if (prepared.size > 15 * 1024 * 1024) {
      uploadError.value = '压缩后文件仍超过 15 MB，请换一张尺寸更小的图片。'
      return
    }
    uploadStep.value = 'uploading'
    const preparedExt = extensionOf(prepared.name)
    const path = `${crypto.randomUUID()}.${preparedExt}`
    const { error: fileError } = await supabase.storage.from(scoreBucket).upload(path, prepared, { contentType: acceptedTypes[preparedExt], upsert: false })
    if (fileError) { uploadError.value = `文件上传失败：${fileError.message}`; return }
    const { error: rowError } = await supabase.from('scores').insert({ title: name, composer: composer.value.trim() || null, storage_path: path, file_type: preparedExt })
    if (rowError) {
      await supabase.storage.from(scoreBucket).remove([path])
      uploadError.value = `曲谱登记失败：${rowError.message}`
      return
    }
    const saved = prepared.size < original.size ? `图片已缩小 ${Math.round((1 - prepared.size / original.size) * 100)}%。` : ''
    uploadSuccess.value = `曲谱已上传，访客现在可以阅读。${saved}`
    title.value = ''
    composer.value = ''
    file.value = null
    const input = document.getElementById('score-file')
    if (input) input.value = ''
    currentPage.value = 1
    await loadScores()
  } catch (error) {
    uploadError.value = `文件处理或上传失败：${error?.message || '请重试。'}`
  } finally {
    uploadBusy.value = false
    uploadStep.value = ''
  }
}

async function deleteScore(row) {
  if (!isAdmin.value || !window.confirm(`确定删除《${row.title}》吗？`)) return
  const { error: fileError } = await supabase.storage.from(scoreBucket).remove([row.storage_path])
  if (fileError) { listError.value = `删除文件失败：${fileError.message}`; return }
  const { error: rowError } = await supabase.from('scores').delete().eq('id', row.id)
  if (rowError) listError.value = `删除记录失败：${rowError.message}`
  else {
    if (selected.value?.id === row.id) selected.value = null
    await loadScores()
  }
}

function resetImageZoom() {
  imageFullscreen.value = false
  imageZoom.value = 1
  imageOffset.value = { x: 0, y: 0 }
  imageDrag = null
  suppressZoomClick = false
}

function exitImageFullscreen() {
  resetImageZoom()
}

function handleImageResize() {
  imageZoom.value = 1
  imageOffset.value = { x: 0, y: 0 }
  imageDrag = null
  suppressZoomClick = false
}

function clampImageOffset(x, y, zoom = imageZoom.value) {
  const stage = imageStage.value
  const image = imageElement.value
  if (!stage || !image?.naturalWidth || !image?.naturalHeight) return { x: 0, y: 0 }
  const width = stage.clientWidth
  const height = stage.clientHeight
  const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const maxX = Math.max(0, (image.naturalWidth * fit * zoom - width) / 2)
  const maxY = Math.max(0, (image.naturalHeight * fit * zoom - height) / 2)
  return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
}

function toggleImageZoom(event) {
  if (suppressZoomClick) { suppressZoomClick = false; return }
  if (!imageFullscreen.value) {
    imageFullscreen.value = true
    imageZoom.value = 1
    imageOffset.value = { x: 0, y: 0 }
    return
  }
  if (imageZoom.value > 1) { handleImageResize(); return }
  const stage = imageStage.value
  if (!stage) return
  const zoom = 2.5
  const bounds = stage.getBoundingClientRect()
  const x = event.detail ? event.clientX - bounds.left : bounds.width / 2
  const y = event.detail ? event.clientY - bounds.top : bounds.height / 2
  imageZoom.value = zoom
  imageOffset.value = clampImageOffset((bounds.width / 2 - x) * (zoom - 1), (bounds.height / 2 - y) * (zoom - 1), zoom)
}

function startImageDrag(event) {
  if (imageZoom.value === 1) return
  imageDrag = { x: event.clientX, y: event.clientY, offset: { ...imageOffset.value }, moved: false }
  event.currentTarget.setPointerCapture(event.pointerId)
}

function moveImageDrag(event) {
  if (!imageDrag) return
  const dx = event.clientX - imageDrag.x
  const dy = event.clientY - imageDrag.y
  if (Math.abs(dx) + Math.abs(dy) > 4) imageDrag.moved = true
  imageOffset.value = clampImageOffset(imageDrag.offset.x + dx, imageDrag.offset.y + dy)
}

function endImageDrag(event) {
  if (event.type === 'pointerup' && imageDrag?.moved) suppressZoomClick = true
  imageDrag = null
}

function closePreview() { selected.value = null; previewRequest++; resetImageZoom() }
function handleEscape(event) {
  if (event.key !== 'Escape') return
  if (imageFullscreen.value) exitImageFullscreen()
  else closePreview()
}

watch(selected, async (row, oldRow) => {
  if (row && !oldRow) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else if (!row && oldRow) document.body.style.overflow = previousBodyOverflow
  resetImageZoom()
  previewError.value = ''
  if (!row || fileKind(row) !== 'musicxml') return
  const request = ++previewRequest
  previewBusy.value = true
  await nextTick()
  try {
    const response = await fetch(publicUrl(row))
    if (!response.ok) throw new Error('无法下载曲谱')
    const xml = await response.text()
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay')
    if (request !== previewRequest || !musicContainer.value) return
    const renderer = new OpenSheetMusicDisplay(musicContainer.value, { autoResize: true, backend: 'svg', drawTitle: false })
    await renderer.load(xml)
    if (request === previewRequest) renderer.render()
  } catch {
    if (request === previewRequest) previewError.value = '这份 MusicXML 暂时无法在页面中显示，可以打开原文件查看。'
  } finally {
    if (request === previewRequest) previewBusy.value = false
  }
})

onMounted(async () => {
  document.addEventListener('keydown', handleEscape)
  document.addEventListener('paste', handlePaste)
  window.addEventListener('resize', handleImageResize)
  if (!supabase) return
  await Promise.all([loadScores(), refreshIdentity()])
  const { data } = supabase.auth.onAuthStateChange(() => { setTimeout(refreshIdentity, 0) })
  authSubscription = data.subscription
})
onBeforeUnmount(() => {
  if (selected.value) document.body.style.overflow = previousBodyOverflow
  document.removeEventListener('keydown', handleEscape)
  document.removeEventListener('paste', handlePaste)
  window.removeEventListener('resize', handleImageResize)
  authSubscription?.unsubscribe()
  previewRequest++
})
</script>

<template>
  <section class="scores-workspace">
    <div class="card score-intro">
      <div><div class="section-kicker">SHEET MUSIC LIBRARY</div><h2>曲谱收藏</h2><p>挑一首曲子，边看谱边练习。支持图片、PDF 和 MusicXML 曲谱。</p></div>
      <span class="score-count">{{ scoreTotal }} <small>份曲谱</small></span>
    </div>

    <div v-if="!supabase" class="card score-state">曲谱库正在配置，完成后就能在这里浏览曲谱。</div>
    <template v-else>
      <div v-if="loading" class="card score-state">正在加载曲谱…</div>
      <p v-if="listError" class="score-error" role="alert">{{ listError }}</p>
      <div v-if="!loading && !listError && !scores.length" class="card score-state"><span>♫</span><strong>曲谱库还是空的</strong><p>第一份曲谱上传后会显示在这里。</p></div>
      <div v-else class="score-grid">
        <article v-for="row in scores" :key="row.id" class="card score-card">
          <div class="score-cover" :class="`score-cover-${fileKind(row)}`"><img v-if="fileKind(row) === 'image'" :src="publicUrl(row)" :alt="`${row.title} 封面`" loading="lazy"><span v-else>{{ fileKind(row) === 'pdf' ? 'PDF' : '♬' }}</span></div>
          <div class="score-card-body"><span class="section-kicker">{{ row.file_type.toUpperCase() }} · {{ dateLabel(row.created_at) }}</span><h3>{{ row.title }}</h3><p>{{ row.composer || '曲谱收藏' }}</p><div class="score-card-actions"><button class="primary-button" type="button" @click="selected = row">预览曲谱</button><button v-if="isAdmin" class="score-delete" type="button" :aria-label="`删除 ${row.title}`" @click="deleteScore(row)">删除</button></div></div>
        </article>
      </div>

      <nav v-if="scoreTotal > pageSize" class="score-pagination" aria-label="曲谱分页">
        <span>第 {{ (currentPage - 1) * pageSize + 1 }}–{{ Math.min(currentPage * pageSize, scoreTotal) }} 条，共 {{ scoreTotal }} 条</span>
        <div>
          <button type="button" :disabled="currentPage === 1 || loading" @click="goToPage(currentPage - 1)">上一页</button>
          <button v-for="page in pageNumbers" :key="page" type="button" :class="{ active: page === currentPage }" :aria-label="`第 ${page} 页`" :aria-current="page === currentPage ? 'page' : undefined" :disabled="loading" @click="goToPage(page)">{{ page }}</button>
          <button type="button" :disabled="currentPage === totalPages || loading" @click="goToPage(currentPage + 1)">下一页</button>
        </div>
      </nav>

      <div class="card score-admin">
        <template v-if="isAdmin">
          <div class="score-admin-head"><div><div class="section-kicker">ADMIN STUDIO</div><h2>上传曲谱</h2></div><button type="button" class="score-text-button" @click="signOut">退出登录</button></div>
          <form class="score-form" @submit.prevent="uploadScore">
            <label>曲谱标题 <input v-model="title" required maxlength="120" placeholder="例如：小星星"></label>
            <label>作者 / 来源 <input v-model="composer" maxlength="120" placeholder="选填"></label>
            <label class="score-file-label">曲谱文件 <input id="score-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.musicxml,.xml" :disabled="uploadBusy" @change="chooseFile"><small>图片上传前自动压缩；PDF、图片或 MusicXML · 上传上限 15 MB</small></label>
            <div class="score-paste-field"><span>也可以复制粘贴</span><textarea ref="pasteZone" class="score-paste-zone" rows="2" aria-label="粘贴曲谱" placeholder="点这里后按 Ctrl+V / ⌘V，或在手机上长按粘贴图片、文件、MusicXML 文本"></textarea><small v-if="file" class="score-selected-file">已准备：{{ file.name }}（{{ (file.size / 1024 / 1024).toFixed(2) }} MB）</small></div>
            <button class="primary-button" type="submit" :disabled="uploadBusy">{{ uploadBusy ? (uploadStep === 'compressing' ? '正在压缩图片…' : '上传中…') : '上传并发布' }}</button>
          </form>
          <p v-if="uploadError" class="score-error" role="alert">{{ uploadError }}</p><p v-if="uploadSuccess" class="score-success" role="status">{{ uploadSuccess }}</p>
        </template>
        <template v-else>
          <div class="score-admin-head"><div><div class="section-kicker">ADMIN STUDIO</div><h2>曲谱管理</h2><p>访客无需登录即可阅读曲谱。</p></div><button type="button" class="score-text-button" @click="showLogin = !showLogin">{{ showLogin ? '收起' : '管理员登录' }}</button></div>
          <form v-if="showLogin" class="score-login" @submit.prevent="signIn"><label>邮箱<input v-model="email" type="email" autocomplete="username" required></label><label>密码<input v-model="password" type="password" autocomplete="current-password" required></label><button class="primary-button" type="submit" :disabled="loginBusy">{{ loginBusy ? '登录中…' : '登录' }}</button><p v-if="loginError" class="score-error" role="alert">{{ loginError }}</p></form>
        </template>
      </div>
    </template>

    <div v-if="selected" class="score-preview-backdrop" :class="{ 'is-image-fullscreen': imageFullscreen }" @click.self="closePreview">
      <div class="score-preview" role="dialog" aria-modal="true" :aria-label="`预览 ${selected.title}`">
        <div class="score-preview-bar">
          <div><strong>{{ selected.title }}</strong><small>{{ selected.composer || '曲谱预览' }}</small></div>
          <div>
            <a :href="selectedUrl" target="_blank" rel="noopener noreferrer">打开原文件 ↗</a>
            <button v-if="imageFullscreen" class="score-expand-button" type="button" @click="exitImageFullscreen">退出全屏</button>
            <button type="button" aria-label="关闭预览" @click="closePreview">×</button>
          </div>
        </div>
        <div class="score-preview-body" :class="{ 'score-preview-image': fileKind(selected) === 'image' }">
          <button v-if="fileKind(selected) === 'image'" ref="imageStage" class="score-image-stage" :class="{ 'is-zoomed': imageZoom > 1 }" type="button" :aria-label="!imageFullscreen ? '全屏查看曲谱图片' : imageZoom > 1 ? '缩小曲谱图片' : '放大曲谱细节'" @click="toggleImageZoom" @pointerdown="startImageDrag" @pointermove="moveImageDrag" @pointerup="endImageDrag" @pointercancel="endImageDrag">
            <img ref="imageElement" :src="selectedUrl" :alt="selected.title" draggable="false" :style="{ transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageZoom})` }">
            <span class="score-image-hint">{{ !imageFullscreen ? '点击全屏查看' : imageZoom > 1 ? '拖动查看 · 点击还原' : '已适配全屏 · 点击放大细节' }}</span>
          </button>
          <iframe v-else-if="fileKind(selected) === 'pdf'" :src="selectedUrl" :title="selected.title"></iframe>
          <div v-else class="score-musicxml"><p v-if="previewBusy">正在排版曲谱…</p><p v-if="previewError" class="score-error" role="alert">{{ previewError }}</p><div ref="musicContainer"></div></div>
        </div>
      </div>
    </div>
  </section>
</template>

