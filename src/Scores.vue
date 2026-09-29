<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { scoreBucket, supabase } from './supabase'

const scores = ref([])
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
const uploadError = ref('')
const uploadSuccess = ref('')
const title = ref('')
const composer = ref('')
const file = ref(null)
const pasteZone = ref(null)
const selected = ref(null)
const previewError = ref('')
const previewBusy = ref(false)
const musicContainer = ref(null)
let authSubscription
let previewRequest = 0

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
  loading.value = true
  listError.value = ''
  const { data, error } = await supabase.from('scores').select('id,title,composer,storage_path,file_type,created_at').order('created_at', { ascending: false })
  if (error) listError.value = '曲谱暂时无法加载，请稍后刷新重试。'
  else scores.value = data || []
  loading.value = false
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
  if (file.value.size > 15 * 1024 * 1024) { uploadError.value = '单个文件不能超过 15 MB。'; return }
  uploadBusy.value = true
  const path = `${crypto.randomUUID()}.${ext}`
  const { error: fileError } = await supabase.storage.from(scoreBucket).upload(path, file.value, { contentType: acceptedTypes[ext], upsert: false })
  if (fileError) {
    uploadError.value = `文件上传失败：${fileError.message}`
    uploadBusy.value = false
    return
  }
  const { error: rowError } = await supabase.from('scores').insert({ title: name, composer: composer.value.trim() || null, storage_path: path, file_type: ext })
  if (rowError) {
    await supabase.storage.from(scoreBucket).remove([path])
    uploadError.value = `曲谱登记失败：${rowError.message}`
  } else {
    uploadSuccess.value = '曲谱已上传，访客现在可以阅读。'
    title.value = ''
    composer.value = ''
    file.value = null
    const input = document.getElementById('score-file')
    if (input) input.value = ''
    await loadScores()
  }
  uploadBusy.value = false
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

function closePreview() { selected.value = null; previewRequest++ }
function handleEscape(event) { if (event.key === 'Escape') closePreview() }

watch(selected, async row => {
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
  if (!supabase) return
  await Promise.all([loadScores(), refreshIdentity()])
  const { data } = supabase.auth.onAuthStateChange(() => { setTimeout(refreshIdentity, 0) })
  authSubscription = data.subscription
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleEscape)
  document.removeEventListener('paste', handlePaste)
  authSubscription?.unsubscribe()
  previewRequest++
})
</script>

<template>
  <section class="scores-workspace">
    <div class="card score-intro">
      <div><div class="section-kicker">SHEET MUSIC LIBRARY</div><h2>曲谱收藏</h2><p>挑一首曲子，边看谱边练习。支持图片、PDF 和 MusicXML 曲谱。</p></div>
      <span class="score-count">{{ scores.length }} <small>份曲谱</small></span>
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

      <div class="card score-admin">
        <template v-if="isAdmin">
          <div class="score-admin-head"><div><div class="section-kicker">ADMIN STUDIO</div><h2>上传曲谱</h2></div><button type="button" class="score-text-button" @click="signOut">退出登录</button></div>
          <form class="score-form" @submit.prevent="uploadScore">
            <label>曲谱标题 <input v-model="title" required maxlength="120" placeholder="例如：小星星"></label>
            <label>作者 / 来源 <input v-model="composer" maxlength="120" placeholder="选填"></label>
            <label class="score-file-label">曲谱文件 <input id="score-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.musicxml,.xml" @change="chooseFile"><small>PDF、图片或 MusicXML · 最大 15 MB</small></label>
            <div class="score-paste-field"><span>也可以复制粘贴</span><textarea ref="pasteZone" class="score-paste-zone" rows="2" aria-label="粘贴曲谱" placeholder="点这里后按 Ctrl+V / ⌘V，或在手机上长按粘贴图片、文件、MusicXML 文本"></textarea><small v-if="file" class="score-selected-file">已准备：{{ file.name }}（{{ (file.size / 1024 / 1024).toFixed(2) }} MB）</small></div>
            <button class="primary-button" type="submit" :disabled="uploadBusy">{{ uploadBusy ? '上传中…' : '上传并发布' }}</button>
          </form>
          <p v-if="uploadError" class="score-error" role="alert">{{ uploadError }}</p><p v-if="uploadSuccess" class="score-success" role="status">{{ uploadSuccess }}</p>
        </template>
        <template v-else>
          <div class="score-admin-head"><div><div class="section-kicker">ADMIN STUDIO</div><h2>曲谱管理</h2><p>访客无需登录即可阅读曲谱。</p></div><button type="button" class="score-text-button" @click="showLogin = !showLogin">{{ showLogin ? '收起' : '管理员登录' }}</button></div>
          <form v-if="showLogin" class="score-login" @submit.prevent="signIn"><label>邮箱<input v-model="email" type="email" autocomplete="username" required></label><label>密码<input v-model="password" type="password" autocomplete="current-password" required></label><button class="primary-button" type="submit" :disabled="loginBusy">{{ loginBusy ? '登录中…' : '登录' }}</button><p v-if="loginError" class="score-error" role="alert">{{ loginError }}</p></form>
        </template>
      </div>
    </template>

    <div v-if="selected" class="score-preview-backdrop" @click.self="closePreview"><div class="score-preview" role="dialog" aria-modal="true" :aria-label="`预览 ${selected.title}`"><div class="score-preview-bar"><div><strong>{{ selected.title }}</strong><small>{{ selected.composer || '曲谱预览' }}</small></div><div><a :href="selectedUrl" target="_blank" rel="noopener noreferrer">打开原文件 ↗</a><button type="button" aria-label="关闭预览" @click="closePreview">×</button></div></div><div class="score-preview-body"><img v-if="fileKind(selected) === 'image'" :src="selectedUrl" :alt="selected.title"><iframe v-else-if="fileKind(selected) === 'pdf'" :src="selectedUrl" :title="selected.title"></iframe><div v-else class="score-musicxml"><p v-if="previewBusy">正在排版曲谱…</p><p v-if="previewError" class="score-error" role="alert">{{ previewError }}</p><div ref="musicContainer"></div></div></div></div></div>
  </section>
</template>

