<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { scoreBucket, supabase } from './supabase'

const storageKey = 'tonecraft.harmonica.scoreId'
const rows = ref([])
const selected = ref(null)
const query = ref('')
const busy = ref(false)
const error = ref('')
const previewError = ref('')
const previewBusy = ref(false)
const musicContainer = ref(null)
const expanded = ref(false)
const readZoom = ref(false)
const searchOpen = ref(false)
const selectedId = computed(() => selected.value?.id || '')
const kind = computed(() => !selected.value ? '' : ['png', 'jpg', 'jpeg', 'webp'].includes(selected.value.file_type) ? 'image' : selected.value.file_type === 'pdf' ? 'pdf' : 'musicxml')
const fileUrl = computed(() => selected.value ? supabase?.storage.from(scoreBucket).getPublicUrl(selected.value.storage_path).data.publicUrl || '' : '')
let searchRequest = 0
let previewRequest = 0

async function searchScores(preferredId = '') {
  if (!supabase) return
  const request = ++searchRequest
  busy.value = true
  error.value = ''
  let statement = supabase.from('scores').select('id,title,composer,storage_path,file_type,created_at')
  const term = query.value.trim().replace(/[%,()]/g, ' ')
  if (term) statement = statement.ilike('title', `%${term}%`)
  const { data, error: fetchError } = await statement.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(30)
  if (request !== searchRequest) return
  busy.value = false
  if (fetchError) { error.value = '曲谱暂时无法加载，请稍后重试。'; return }
  rows.value = data || []
  if (!selected.value) {
    selected.value = rows.value.find(row => row.id === preferredId) || rows.value[0] || null
  }
}

function chooseScore(event) {
  selected.value = rows.value.find(row => row.id === event.target.value) || null
  event.target.blur()
}

function submitSearch(event) {
  event.target.querySelector('input')?.blur()
  searchOpen.value = false
  searchScores()
}

function clearSearch() {
  query.value = ''
  searchScores()
}

function closeExpanded() { expanded.value = false }
function onEscape(event) { if (event.key === 'Escape') closeExpanded() }

watch(selected, async row => {
  const request = ++previewRequest
  previewError.value = ''
  previewBusy.value = false
  expanded.value = false
  readZoom.value = false
  try {
    if (row) localStorage.setItem(storageKey, row.id)
    else localStorage.removeItem(storageKey)
  } catch { /* Browser storage may be unavailable. */ }
  if (!row || kind.value !== 'musicxml') return
  previewBusy.value = true
  await nextTick()
  try {
    const response = await fetch(fileUrl.value)
    if (!response.ok) throw new Error('download failed')
    const xml = await response.text()
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay')
    if (request !== previewRequest || !musicContainer.value) return
    musicContainer.value.replaceChildren()
    const renderer = new OpenSheetMusicDisplay(musicContainer.value, { autoResize: true, backend: 'svg', drawTitle: false })
    await renderer.load(xml)
    if (request === previewRequest) renderer.render()
  } catch {
    if (request === previewRequest) previewError.value = '无法显示这份 MusicXML，请打开原文件查看。'
  } finally {
    if (request === previewRequest) previewBusy.value = false
  }
})

onMounted(async () => {
  document.addEventListener('keydown', onEscape)
  let savedId = ''
  try { savedId = localStorage.getItem(storageKey) || '' } catch { /* Browser storage may be unavailable. */ }
  if (supabase && savedId) {
    const { data } = await supabase.from('scores').select('id,title,composer,storage_path,file_type,created_at').eq('id', savedId).maybeSingle()
    if (data) selected.value = data
  }
  await searchScores(savedId)
})
onBeforeUnmount(() => { searchRequest++; previewRequest++; document.removeEventListener('keydown', onEscape) })
</script>

<template>
  <section class="card harmonica-score" aria-label="演奏曲谱">
    <div class="harmonica-score-heading">
      <div><div class="section-kicker">PLAY ALONG</div><h2>边看谱，边吹奏</h2></div>
      <span class="harmonica-score-caption">曲谱在上 · 音孔在下</span>
    </div>
    <template v-if="supabase">
      <div class="harmonica-score-toolbar">
        <label for="harmonica-score-select">选择曲谱</label>
        <select id="harmonica-score-select" :value="selectedId" :disabled="busy || !rows.length" @change="chooseScore">
          <option v-if="selected && !rows.some(row => row.id === selected.id)" :value="selected.id">{{ selected.title }}（当前）</option>
          <option v-if="!rows.length" value="">{{ busy ? '正在加载…' : '没有曲谱' }}</option>
          <option v-for="row in rows" :key="row.id" :value="row.id">{{ row.title }}{{ row.composer ? ` · ${row.composer}` : '' }}</option>
        </select>
        <button class="harmonica-score-search-toggle" type="button" :aria-expanded="searchOpen" @click="searchOpen = !searchOpen">查找</button>
        <form class="harmonica-score-search" :class="{ 'is-open': searchOpen }" @submit.prevent="submitSearch">
          <input v-model="query" aria-label="搜索曲谱标题" type="search" placeholder="搜索曲谱标题" @keydown.esc="$event.target.blur()">
          <button type="submit" :disabled="busy">搜索</button>
          <button v-if="query" type="button" @click="clearSearch">清除</button>
        </form>
      </div>
      <p v-if="error" class="score-error" role="alert">{{ error }}</p>
      <div v-if="selected" class="harmonica-score-viewer" :class="`harmonica-score-${kind}`">
        <div v-if="kind === 'image'" class="harmonica-score-image-scroll" :class="{ 'is-reading': readZoom }"><img :src="fileUrl" :alt="selected.title" @click="readZoom = !readZoom"></div>
        <iframe v-else-if="kind === 'pdf'" :key="selected.id" :src="fileUrl" :title="selected.title"></iframe>
        <div v-else class="harmonica-score-musicxml"><p v-if="previewBusy">正在排版曲谱…</p><p v-if="previewError" class="score-error" role="alert">{{ previewError }}</p><div ref="musicContainer"></div></div>
        <div v-if="kind === 'image'" class="harmonica-score-view-actions"><button type="button" @click="readZoom = !readZoom">{{ readZoom ? '适配全貌' : '放大阅读' }}</button><button type="button" @click="expanded = true">全屏看谱</button></div>
      </div>
      <div v-else class="harmonica-score-empty">{{ busy ? '正在加载曲谱…' : query ? '没有找到匹配的曲谱。' : '曲谱库暂无曲谱，仍可在下方吹奏。' }}</div>
      <div v-if="selected" class="harmonica-score-bottom"><span>{{ selected.title }}{{ selected.composer ? ` · ${selected.composer}` : '' }}</span><a :href="fileUrl" target="_blank" rel="noopener noreferrer">打开原文件 ↗</a></div>
    </template>
    <div v-else class="harmonica-score-empty">曲谱库尚未配置，仍可在下方吹奏。</div>
    <div v-if="expanded && kind === 'image'" class="harmonica-score-lightbox" role="dialog" aria-modal="true" :aria-label="`全屏查看 ${selected.title}`" @click.self="closeExpanded">
      <button type="button" aria-label="关闭全屏曲谱" @click="closeExpanded">×</button>
      <img :src="fileUrl" :alt="selected.title" @click="closeExpanded">
    </div>
  </section>
</template>

