<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createHarmonicaVoice, harmonicaKeys, harmonicaMidi, harmonicaNoteName, harmonicaSamplesReady, prepareHarmonicaSamples } from './harmonica'
import HarmonicaScore from './HarmonicaScore.vue'
import './harmonica.css'

const props = defineProps({ volume: { type: Number, default: 100 } })
const emit = defineEmits(['update:volume'])

const held = new Map()
const heldKeys = ref([])
const mouseButtons = ref(0)
const touchModifiers = new Map()
const touchState = ref({ low: false, high: false, sharp: false })
const lastNote = ref(null)
const playedCount = ref(0)
const sampleState = ref(harmonicaSamplesReady() ? 'ready' : 'loading')

const low = computed(() => Boolean(mouseButtons.value & 1) || touchState.value.low)
const high = computed(() => Boolean(mouseButtons.value & 2) || touchState.value.high)
const sharp = computed(() => Boolean(mouseButtons.value & 4) || touchState.value.sharp)
const octave = computed(() => high.value ? 'high' : low.value ? 'low' : 'middle')
const octaveLabel = computed(() => octave.value === 'low' ? '低音' : octave.value === 'high' ? '高音' : '中音')
const currentMidi = computed(() => heldKeys.value.length ? harmonicaMidi(heldKeys.value.at(-1), octave.value, sharp.value) : lastNote.value)
const currentName = computed(() => currentMidi.value === null ? '—' : harmonicaNoteName(currentMidi.value))

function refreshHeld() {
  heldKeys.value = [...held.values()].map(item => item.key)
}

function retune() {
  for (const item of held.values()) item.voice.setPitch(harmonicaMidi(item.key, octave.value, sharp.value))
  if (heldKeys.value.length) lastNote.value = harmonicaMidi(heldKeys.value.at(-1), octave.value, sharp.value)
}

function startNote(id, key) {
  if (held.has(id)) return
  const midi = harmonicaMidi(key, octave.value, sharp.value)
  if (midi === null) return
  held.set(id, { key, voice: createHarmonicaVoice(midi, props.volume) })
  lastNote.value = midi
  playedCount.value++
  refreshHeld()
}

function stopNote(id) {
  const item = held.get(id)
  if (!item) return
  item.voice.release()
  held.delete(id)
  refreshHeld()
}

function stopAll() {
  for (const id of held.keys()) stopNote(id)
  mouseButtons.value = 0
  touchModifiers.clear()
  touchState.value = { low: false, high: false, sharp: false }
}

function onKeyDown(event) {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return
  const key = event.key.toLowerCase()
  if (!harmonicaKeys.some(item => item.key === key)) return
  event.preventDefault()
  startNote(`key:${key}`, key)
}

function onKeyUp(event) {
  const key = event.key.toLowerCase()
  if (!harmonicaKeys.some(item => item.key === key)) return
  event.preventDefault()
  stopNote(`key:${key}`)
}

function onMouseDown(event) {
  mouseButtons.value = event.buttons
  if (event.button === 1) event.preventDefault()
}

function onMouseUp(event) {
  mouseButtons.value = event.buttons
}

function onContextMenu(event) { event.preventDefault() }

function onNotePointerDown(event, key) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  event.preventDefault()
  startNote(`pointer:${event.pointerId}`, key)
}

function onModifierPointerDown(event, modifier) {
  if (event.pointerType === 'mouse') return
  event.preventDefault()
  touchModifiers.set(event.pointerId, modifier)
  refreshTouchModifiers()
}

function refreshTouchModifiers() {
  const active = [...touchModifiers.values()]
  touchState.value = { low: active.includes('low'), high: active.includes('high'), sharp: active.includes('sharp') }
}

function onPointerEnd(event) {
  stopNote(`pointer:${event.pointerId}`)
  if (touchModifiers.delete(event.pointerId)) refreshTouchModifiers()
}

watch([octave, sharp], retune, { flush: 'sync' })
watch(() => props.volume, value => {
  for (const item of held.values()) item.voice.setVolume(value)
})

onMounted(() => {
  prepareHarmonicaSamples().then(() => { sampleState.value = 'ready' }).catch(() => { sampleState.value = 'fallback' })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('pointerup', onPointerEnd)
  window.addEventListener('pointercancel', onPointerEnd)
  window.addEventListener('blur', stopAll)
  document.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

function onVisibilityChange() { if (document.hidden) stopAll() }

onBeforeUnmount(() => {
  stopAll()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('mousedown', onMouseDown)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('pointerup', onPointerEnd)
  window.removeEventListener('pointercancel', onPointerEnd)
  window.removeEventListener('blur', stopAll)
  document.removeEventListener('contextmenu', onContextMenu)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <section class="harmonica-workspace workspace" aria-label="三角洲口琴模拟器">
    <HarmonicaScore />
    <div class="card harmonica-card">
      <div class="card-title-row"><div><div class="section-kicker">INSTRUMENT 03</div><h2>三角洲口琴</h2></div><span class="pill">C3 — C6 · 8 NOTES</span></div>
      <div class="harmonica-hero">
        <div class="harmonica-breath" :class="{ sounding: heldKeys.length }" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <div class="harmonica-readout"><small>当前音高 / NOW PLAYING</small><strong>{{ currentName }}</strong><span>{{ heldKeys.length ? '正在吹奏' : '按住键盘或下方音孔开始吹奏' }} · {{ sampleState === 'ready' ? 'VCSL 真实采样' : sampleState === 'loading' ? '正在加载音色' : '合成音备用' }}</span></div>
        <div class="harmonica-status"><span :class="{ active: low }">低音</span><span :class="{ active: octave === 'middle' }">中音</span><span :class="{ active: high }">高音</span><span :class="{ active: sharp }">♯ 半音</span></div>
      </div>

      <div class="harmonica-control-label"><span>音域控制 / OCTAVE</span><small>电脑按住鼠标；手机按住下方控制键</small></div>
      <div class="harmonica-modifiers">
        <button type="button" :class="{ active: low }" :aria-pressed="low" @pointerdown="onModifierPointerDown($event, 'low')"><span class="harmonica-mouse-icon">◖</span><strong>低音</strong><small>鼠标左键 · C3–C4</small></button>
        <div class="harmonica-middle" :class="{ active: octave === 'middle' }"><strong>{{ octaveLabel }}</strong><small>{{ octave === 'low' ? 'C3–C4' : octave === 'high' ? 'C5–C6' : 'C4–C5' }}</small></div>
        <button type="button" :class="{ active: high }" :aria-pressed="high" @pointerdown="onModifierPointerDown($event, 'high')"><span class="harmonica-mouse-icon">◗</span><strong>高音</strong><small>鼠标右键 · C5–C6</small></button>
        <button type="button" class="harmonica-sharp" :class="{ active: sharp }" :aria-pressed="sharp" @pointerdown="onModifierPointerDown($event, 'sharp')"><span class="harmonica-mouse-icon">♯</span><strong>升半音</strong><small>鼠标中键 · 可组合</small></button>
      </div>

      <div class="harmonica-control-label"><span>吹奏音孔 / PLAY</span><small>按住 0.5 秒渐强，松开后 0.5 秒渐弱</small></div>
      <div class="harmonica-keys" role="group" aria-label="口琴音孔">
        <button v-for="note in harmonicaKeys" :key="note.key" type="button" class="harmonica-key" :class="{ active: heldKeys.includes(note.key) }" :aria-label="`${note.degree} 音，键盘 ${note.key === ',' ? '逗号' : note.key}，${harmonicaNoteName(harmonicaMidi(note.key, octave, sharp))}`" @pointerdown="onNotePointerDown($event, note.key)">
          <span class="harmonica-hole"></span><span class="harmonica-degree">{{ note.degree }}</span><span class="harmonica-pitch">{{ harmonicaNoteName(harmonicaMidi(note.key, octave, sharp)) }}</span><kbd>{{ note.key === ',' ? ',' : note.key.toUpperCase() }}</kbd>
        </button>
      </div>

      <div class="harmonica-footer"><div class="volume-control"><div class="volume-heading"><span class="volume-symbol" aria-hidden="true">♫</span><label for="harmonica-volume">口琴音量</label><strong>{{ volume }}%</strong></div><input id="harmonica-volume" type="range" min="0" max="100" step="1" :value="volume" :style="{ '--volume-fill': `${volume}%` }" aria-label="口琴音量" @input="emit('update:volume', Number($event.target.value))"></div><p>键盘 <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> <kbd>V</kbd> <kbd>B</kbd> <kbd>N</kbd> <kbd>M</kbd> <kbd>,</kbd> 对应 1–7、i。松开鼠标时，按住的音会立即回到中音。音源：<a href="https://github.com/sgossner/VCSL" target="_blank" rel="noopener noreferrer">VCSL · CC0</a>。</p></div>
    </div>
    <div class="info-grid"><div class="info-card"><span class="info-icon">♫</span><div><small>完整音域</small><strong>C3 — C6</strong></div></div><div class="info-card"><span class="info-icon">◉</span><div><small>当前音区</small><strong>{{ octaveLabel }}{{ sharp ? ' · 升半音' : '' }}</strong></div></div><div class="info-card"><span class="info-icon">▦</span><div><small>累计吹奏</small><strong>{{ playedCount }} <em>次</em></strong></div></div></div>
  </section>
</template>

