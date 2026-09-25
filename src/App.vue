<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { audioContext, detectPitch, midiToFrequency, playInstrument, playMetronome } from './audio'

const tabs = [
  { id: 'piano', label: '钢琴', icon: '▥', number: '01' },
  { id: 'guitar', label: '吉他', icon: '♮', number: '02' },
  { id: 'metronome', label: '节拍器', icon: '◉', number: '03' },
  { id: 'tuner', label: '调音器', icon: '◌', number: '04' },
]
const activeTab = ref('piano')
const showLabels = ref(true)
const showHints = ref(true)
const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const keyboardMap = { A: 48, W: 49, S: 50, E: 51, D: 52, F: 53, T: 54, G: 55, Y: 56, H: 57, U: 58, J: 59, K: 60, O: 61, L: 62, P: 63, ';': 64, "'": 65, '[': 66, ']': 68 }
const hintForMidi = midi => Object.keys(keyboardMap).find(key => keyboardMap[key] === midi) || ''
const isBlack = (midi) => [1, 3, 6, 8, 10].includes(midi % 12)
const pianoNotes = Array.from({ length: 25 }, (_, i) => {
  const midi = i + 48
  return { midi, name: noteNames[midi % 12], octave: Math.floor(midi / 12) - 1, black: isBlack(midi) }
})
const whiteNotes = pianoNotes.filter(note => !note.black)
const blackNotes = pianoNotes.filter(note => note.black).map(note => ({
  ...note,
  afterWhite: pianoNotes.slice(0, note.midi - 48).filter(n => !n.black).length,
}))
const currentNote = ref(null)
const pressedMidi = ref(null)
const playedCount = ref(0)
let pressTimer
function noteLabel(midi) { return `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}` }
function playNote(midi, instrument = 'piano') {
  playInstrument(midi, instrument)
  currentNote.value = { midi, name: noteLabel(midi), frequency: Math.round(midiToFrequency(midi)) }
  pressedMidi.value = midi
  playedCount.value++
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => { pressedMidi.value = null }, 180)
}
function handleKeyboard(event) {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || activeTab.value !== 'piano') return
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
  const key = event.key.toUpperCase()
  if (keyboardMap[key] !== undefined) { event.preventDefault(); playNote(keyboardMap[key]) }
}

const guitarStrings = [
  { name: 'e', midi: 64, gauge: 1 },
  { name: 'B', midi: 59, gauge: 2 },
  { name: 'G', midi: 55, gauge: 3 },
  { name: 'D', midi: 50, gauge: 4 },
  { name: 'A', midi: 45, gauge: 5 },
  { name: 'E', midi: 40, gauge: 6 },
]
const frets = Array.from({ length: 13 }, (_, i) => i)
const selectedFret = ref(null)
function playFret(stringIndex, fret) {
  const midi = guitarStrings[stringIndex].midi + fret
  selectedFret.value = `${stringIndex}-${fret}`
  playNote(midi, 'guitar')
}

const bpm = ref(100)
const beatsPerBar = ref(4)
const beatUnit = ref(4)
const voice = ref('classic')
const voices = [
  { value: 'classic', name: '经典', icon: '◉' },
  { value: 'wood', name: '木鱼', icon: '▣' },
  { value: 'bell', name: '铃声', icon: '♢' },
  { value: 'digital', name: '电子', icon: '▦' },
  { value: 'soft', name: '柔和', icon: '◌' },
]
const accents = ref([3, 1, 1, 1])
const running = ref(false)
const visibleBeat = ref(-1)
const tapTimes = []
let schedulerId
let nextNoteTime = 0
let nextBeatIndex = 0
let beatTimeouts = []
const intervalMs = computed(() => 60000 / bpm.value * 4 / beatUnit.value)
function changeBpm(value) { bpm.value = Math.min(400, Math.max(20, Math.round(Number(value) || 20))) }
function setMeter() {
  const old = accents.value
  accents.value = Array.from({ length: beatsPerBar.value }, (_, i) => old[i] ?? (i === 0 ? 3 : 1))
  nextBeatIndex = 0
}
function cycleAccent(index) { accents.value[index] = (accents.value[index] + 1) % 4 }
function scheduleBeat(index, when) {
  playMetronome(when, voice.value, accents.value[index])
  const delay = Math.max(0, (when - audioContext().currentTime) * 1000)
  beatTimeouts.push(setTimeout(() => { if (running.value) visibleBeat.value = index }, delay))
}
function scheduler() {
  const ctx = audioContext()
  while (nextNoteTime < ctx.currentTime + 0.12) {
    scheduleBeat(nextBeatIndex, nextNoteTime)
    nextNoteTime += 60 / bpm.value * 4 / beatUnit.value
    nextBeatIndex = (nextBeatIndex + 1) % beatsPerBar.value
  }
}
function stopMetronome() {
  running.value = false
  clearInterval(schedulerId)
  beatTimeouts.forEach(clearTimeout)
  beatTimeouts = []
  visibleBeat.value = -1
}
function toggleMetronome() {
  if (running.value) return stopMetronome()
  const ctx = audioContext()
  running.value = true
  nextBeatIndex = 0
  nextNoteTime = ctx.currentTime + 0.04
  scheduler()
  schedulerId = setInterval(scheduler, 25)
}
function tapTempo() {
  const time = performance.now()
  if (tapTimes.length && time - tapTimes.at(-1) > 2500) tapTimes.length = 0
  tapTimes.push(time)
  if (tapTimes.length > 6) tapTimes.shift()
  if (tapTimes.length >= 2) {
    const gaps = tapTimes.slice(1).map((t, i) => t - tapTimes[i])
    const average = gaps.reduce((a, b) => a + b, 0) / gaps.length
    changeBpm(60000 / average)
  }
}
watch(beatsPerBar, setMeter)
watch(beatUnit, () => { if (running.value) { stopMetronome(); toggleMetronome() } })

const listening = ref(false)
const tunerError = ref('')
const detectedFrequency = ref(null)
const cents = ref(0)
const detectedMidi = ref(null)
const tunerNotes = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const nearestNote = computed(() => detectedMidi.value === null ? '—' : tunerNotes[detectedMidi.value % 12])
const nearestOctave = computed(() => detectedMidi.value === null ? '' : Math.floor(detectedMidi.value / 12) - 1)
const tunerStatus = computed(() => {
  if (!listening.value) return '开启麦克风开始调音'
  if (detectedFrequency.value === null) return '请拨动琴弦或弹奏一个音'
  if (Math.abs(cents.value) <= 5) return '音准到位，很棒！'
  return cents.value < 0 ? '音调偏低，稍微调高' : '音调偏高，稍微调低'
})
let stream
let analyser
let tunerSource
let tunerFrame
let previousPitch = null
async function startTuner() {
  tunerError.value = ''
  if (!navigator.mediaDevices?.getUserMedia) {
    tunerError.value = '当前环境无法访问麦克风。请使用 HTTPS 或 localhost 打开页面。'
    return
  }
  try {
    const ctx = audioContext()
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    tunerSource = ctx.createMediaStreamSource(stream)
    analyser = ctx.createAnalyser()
    analyser.fftSize = 4096
    analyser.smoothingTimeConstant = 0
    tunerSource.connect(analyser)
    listening.value = true
    const buffer = new Float32Array(analyser.fftSize)
    let lastAnalysis = 0
    const analyze = (time) => {
      if (!listening.value) return
      if (time - lastAnalysis > 70) {
        lastAnalysis = time
        analyser.getFloatTimeDomainData(buffer)
        const frequency = detectPitch(buffer, ctx.sampleRate)
        if (frequency) {
          const stable = previousPitch && Math.abs(1200 * Math.log2(frequency / previousPitch)) < 80
            ? previousPitch * 0.65 + frequency * 0.35 : frequency
          previousPitch = stable
          const midi = Math.round(69 + 12 * Math.log2(stable / 440))
          detectedMidi.value = midi
          detectedFrequency.value = stable
          cents.value = Math.round(1200 * Math.log2(stable / midiToFrequency(midi)))
        } else {
          detectedFrequency.value = null
          detectedMidi.value = null
          previousPitch = null
        }
      }
      tunerFrame = requestAnimationFrame(analyze)
    }
    tunerFrame = requestAnimationFrame(analyze)
  } catch (error) {
    tunerError.value = error.name === 'NotAllowedError'
      ? '麦克风权限被拒绝。请在浏览器地址栏中允许麦克风后重试。'
      : '无法启动麦克风，请检查设备连接和浏览器权限。'
    stopTuner()
  }
}
function stopTuner() {
  listening.value = false
  cancelAnimationFrame(tunerFrame)
  tunerSource?.disconnect()
  stream?.getTracks().forEach(track => track.stop())
  stream = null
  analyser = null
  tunerSource = null
  detectedFrequency.value = null
  detectedMidi.value = null
  previousPitch = null
}
function toggleTuner() { listening.value ? stopTuner() : startTuner() }
watch(activeTab, tab => { if (tab !== 'tuner' && listening.value) stopTuner() })
onMounted(() => window.addEventListener('keydown', handleKeyboard))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyboard)
  stopMetronome()
  stopTuner()
  clearTimeout(pressTimer)
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark"><span></span><span></span><span></span><span></span></div><div><strong>TONECRAFT</strong><small>YOUR MUSIC SPACE</small></div></div>
      <div class="nav-caption">工作室 / STUDIO</div>
      <nav class="nav-list" aria-label="功能导航">
        <button v-for="tab in tabs" :key="tab.id" class="nav-item" :class="{ selected: activeTab === tab.id }" :aria-label="tab.label" @click="activeTab = tab.id">
          <span class="nav-icon">{{ tab.icon }}</span><span>{{ tab.label }}</span><span class="nav-number">{{ tab.number }}</span>
        </button>
      </nav>
      <div class="sidebar-bottom"><span class="status-dot"></span> 随时开始演奏 <small>v 1.0 / WEB AUDIO</small></div>
    </aside>

    <main class="main-content">
      <header class="topbar"><span>在线音乐工作室 <span class="topbar-divider">/</span> {{ tabs.find(t => t.id === activeTab)?.label }}</span><span class="topbar-right"><span class="status-dot"></span> 音频引擎就绪</span></header>
      <div class="page-content">
        <div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> EXPLORE THE SOUND</div><h1>{{ activeTab === 'piano' ? '钢琴模拟器' : activeTab === 'guitar' ? '吉他指板' : activeTab === 'metronome' ? '节拍器' : '智能调音器' }}<span class="heading-dot">.</span></h1><p>{{ activeTab === 'piano' ? '从第一个音符开始，感受指尖的旋律。' : activeTab === 'guitar' ? '点击琴弦与品位，探索每一个音。' : activeTab === 'metronome' ? '找到你的节奏，让每一次练习更稳定。' : '聆听每一个细节，让音准恰到好处。' }}</p></div><div class="heading-index">{{ tabs.find(t => t.id === activeTab)?.number }} <span>/ 04</span></div></div>

        <section v-if="activeTab === 'piano'" class="workspace">
          <div class="card instrument-card">
            <div class="card-title-row"><div><div class="section-kicker">INSTRUMENT 01</div><h2>经典钢琴</h2></div><span class="pill">C3 — C5 · 25 KEYS</span></div>
            <div class="piano-display"><div class="display-pulse">◉</div><div><small>当前音符 / NOW PLAYING</small><strong>{{ currentNote?.name || '—' }}</strong></div><div class="display-frequency">{{ currentNote ? `${currentNote.frequency} Hz` : '点击琴键开始' }}</div></div>
            <div class="piano-scroll"><div class="piano" role="group" aria-label="钢琴键盘"><button v-for="note in whiteNotes" :key="note.midi" class="white-key" :class="{ active: pressedMidi === note.midi }" :aria-label="`弹奏 ${note.name}${note.octave}`" @pointerdown.prevent="playNote(note.midi)"><span v-if="showLabels" class="key-note">{{ note.name }}{{ note.octave }}</span><span v-if="showHints" class="key-hint">{{ hintForMidi(note.midi) }}</span></button><button v-for="note in blackNotes" :key="note.midi" class="black-key" :class="{ active: pressedMidi === note.midi }" :style="{ left: `calc(${note.afterWhite} * var(--white-width) - var(--black-width) / 2)` }" :aria-label="`弹奏 ${note.name}${note.octave}`" @pointerdown.prevent="playNote(note.midi)"><span v-if="showLabels" class="key-note">{{ note.name }}{{ note.octave }}</span><span v-if="showHints" class="key-hint">{{ hintForMidi(note.midi) }}</span></button></div></div>
            <div class="instrument-footer"><div class="footer-tip"><span>⌨</span> 点击琴键，或使用电脑键盘弹奏</div><div class="switches"><label class="switch-label">音符标记 <input type="checkbox" v-model="showLabels"><span class="switch"></span></label><label class="switch-label">键盘提示 <input type="checkbox" v-model="showHints"><span class="switch"></span></label></div></div>
          </div>
          <div class="info-grid"><div class="info-card"><span class="info-icon">♫</span><div><small>音域范围</small><strong>C3 — C5</strong></div></div><div class="info-card"><span class="info-icon">◉</span><div><small>上次弹奏</small><strong>{{ currentNote?.name || '等待演奏' }}</strong></div></div><div class="info-card"><span class="info-icon">▦</span><div><small>累计弹奏</small><strong>{{ playedCount }} <em>次</em></strong></div></div></div>
        </section>

        <section v-if="activeTab === 'guitar'" class="workspace">
          <div class="card instrument-card guitar-card"><div class="card-title-row"><div><div class="section-kicker">INSTRUMENT 02</div><h2>六弦吉他</h2></div><span class="pill">STANDARD TUNING · E A D G B e</span></div>
            <div class="guitar-topline"><div><span class="mini-dot"></span> 标准调弦 · 12 品指板</div><div class="guitar-toggles"><label class="switch-label">音符标记 <input type="checkbox" v-model="showLabels"><span class="switch"></span></label><label class="switch-label">音调提示 <input type="checkbox" v-model="showHints"><span class="switch"></span></label></div></div>
            <div class="fretboard-scroll"><div class="fretboard"><div v-for="(string, s) in guitarStrings" :key="string.name + s" class="string-row"><div class="string-name">{{ string.name }}</div><button v-for="fret in frets" :key="fret" class="fret" :class="{ 'fret-open': fret === 0, 'fret-selected': selectedFret === `${s}-${fret}` }" :aria-label="`第${s + 1}弦第${fret}品 ${noteLabel(string.midi + fret)}`" @pointerdown.prevent="playFret(s, fret)"><span class="string-line" :style="{ height: `${string.gauge * 0.5 + 0.5}px` }"></span><span v-if="showLabels" class="fret-label">{{ noteNames[(string.midi + fret) % 12] }}</span></button></div><div class="fret-numbers"><span></span><span v-for="fret in frets" :key="fret">{{ fret === 0 ? '空弦' : fret }}</span></div><div class="fret-markers"><span></span><span v-for="fret in frets" :key="fret" :class="{ marked: [3,5,7,9,12].includes(fret) }">{{ [3,5,7,9].includes(fret) ? '●' : fret === 12 ? '● ●' : '' }}</span></div></div></div>
            <div class="guitar-footer"><div class="footer-tip"><span>✦</span> 点击琴格弹奏 · 从上至下为第 1 至第 6 弦</div><div v-if="showHints" class="guitar-current">{{ currentNote ? `${currentNote.name} · ${currentNote.frequency} Hz` : '选择一个琴格试听音高' }}</div></div>
          </div><div class="info-grid"><div class="info-card"><span class="info-icon">♮</span><div><small>调弦方式</small><strong>标准调弦</strong></div></div><div class="info-card"><span class="info-icon">◎</span><div><small>当前音符</small><strong>{{ currentNote?.name || '—' }}</strong></div></div><div class="info-card"><span class="info-icon">▤</span><div><small>指板范围</small><strong>0 — 12 <em>品</em></strong></div></div></div>
        </section>

        <section v-if="activeTab === 'metronome'" class="workspace metronome-layout"><div class="card metro-card"><div class="card-title-row"><div><div class="section-kicker">RHYTHM LAB</div><h2>节奏控制台</h2></div><span class="pill">20 — 400 BPM</span></div><div class="bpm-panel"><div class="bpm-label">每分钟节拍 / BEATS PER MINUTE</div><div class="bpm-control"><button aria-label="减少 BPM" @click="changeBpm(bpm - 1)">−</button><input type="number" min="20" max="400" :value="bpm" aria-label="BPM" @change="changeBpm($event.target.value)"><button aria-label="增加 BPM" @click="changeBpm(bpm + 1)">+</button></div><div class="bpm-unit">BPM</div><input class="bpm-slider" type="range" min="20" max="400" :value="bpm" aria-label="调整 BPM" @input="changeBpm($event.target.value)"><div class="range-labels"><span>20</span><span>慢速</span><span>中速</span><span>快速</span><span>400</span></div></div><div class="meter-controls"><div><label class="field-label">拍号 / TIME SIGNATURE</label><div class="meter-selects"><select v-model.number="beatsPerBar" aria-label="每小节拍数"><option v-for="n in 12" :key="n" :value="n">{{ n }}</option></select><span>/</span><select v-model.number="beatUnit" aria-label="拍号分母"><option v-for="n in [2,4,8,16]" :key="n" :value="n">{{ n }}</option></select></div></div><div><label class="field-label">间隔 / INTERVAL</label><div class="interval-readout">{{ Math.round(intervalMs) }} <span>毫秒</span></div></div></div><div class="beat-section"><div class="field-label">每拍强度 <span>点击循环：强 · 中 · 弱 · 静音</span></div><div class="beat-grid"><button v-for="(accent, index) in accents" :key="index" class="beat-button" :class="[`accent-${accent}`, { current: visibleBeat === index }]" :aria-label="`第${index + 1}拍，强度${accent}`" @click="cycleAccent(index)"><span class="beat-indicator"></span><strong>{{ String(index + 1).padStart(2, '0') }}</strong><small>{{ ['静音','弱','中','强'][accent] }}</small></button></div></div><div class="metro-actions"><button class="primary-button" @click="toggleMetronome"><span>{{ running ? '■' : '▶' }}</span>{{ running ? '停止节拍' : '开始节拍' }}</button><button class="secondary-button" @click="tapTempo">TAP 节奏</button></div></div><div class="card voice-card"><div class="section-kicker">SOUND PALETTE</div><h2>选择音色</h2><p>为节拍选择喜欢的声音。</p><div class="voice-list"><button v-for="item in voices" :key="item.value" class="voice-option" :class="{ selected: voice === item.value }" @click="voice = item.value; playMetronome(audioContext().currentTime + 0.01, item.value, 2)"><span class="voice-icon">{{ item.icon }}</span><span>{{ item.name }}</span><span class="voice-radio"></span></button></div><div class="voice-hint">♫ 选择音色时可即时试听</div></div></section>

        <section v-if="activeTab === 'tuner'" class="workspace tuner-layout"><div class="card tuner-card"><div class="card-title-row"><div><div class="section-kicker">PITCH DETECTION</div><h2>实时音高检测</h2></div><span class="pill" :class="{ live: listening }"><span class="mini-dot"></span>{{ listening ? '正在聆听' : '等待输入' }}</span></div><div class="tuner-main"><div class="tuner-arc"><div class="tuner-ticks"><span v-for="n in 21" :key="n" :class="{ major: n === 1 || n === 6 || n === 11 || n === 16 || n === 21 }"></span></div><div class="tuner-needle-track"><span class="tuner-needle" :style="{ left: `${50 + Math.max(-50, Math.min(50, cents))}%` }"></span></div><div class="tuner-scale"><span>−50</span><span>−25</span><span>0</span><span>+25</span><span>+50</span></div></div><div class="detected-note"><small>检测到的音符 / DETECTED NOTE</small><div>{{ nearestNote }}<span>{{ nearestOctave }}</span></div><strong>{{ detectedFrequency ? `${detectedFrequency.toFixed(1)} Hz` : '— Hz' }}</strong></div><div class="tuner-message" :class="{ inTune: listening && detectedFrequency && Math.abs(cents) <= 5 }"><span>{{ listening && detectedFrequency ? (Math.abs(cents) <= 5 ? '✓' : cents < 0 ? '↗' : '↘') : '◌' }}</span>{{ tunerStatus }}</div><button class="primary-button tuner-button" @click="toggleTuner"><span>{{ listening ? '■' : '◉' }}</span>{{ listening ? '停止调音' : '开启麦克风' }}</button><p v-if="tunerError" class="error-message" role="alert">{{ tunerError }}</p><p class="privacy-note">仅在本机分析音频，不会上传录音。</p></div></div><div class="tuner-side"><div class="card tuning-reference"><div class="section-kicker">QUICK REFERENCE</div><h2>吉他标准调弦</h2><div v-for="(string, index) in guitarStrings" :key="index" class="reference-row"><span>第 {{ index + 1 }} 弦</span><strong>{{ string.name }}{{ Math.floor(string.midi / 12) - 1 }}</strong><small>{{ Math.round(midiToFrequency(string.midi)) }} Hz</small></div></div><div class="tuner-tip"><span>✦</span><div><strong>调音小贴士</strong><p>在安静的环境下，逐根拨动琴弦并等待指针稳定。指针位于中央时最接近标准音高。</p></div></div></div></section>
      </div>
    </main>
  </div>
</template>
