import { audioContext, midiToFrequency } from './audio.js'

export const harmonicaKeys = [
  { key: 'z', degree: '1', semitone: 0 },
  { key: 'x', degree: '2', semitone: 2 },
  { key: 'c', degree: '3', semitone: 4 },
  { key: 'v', degree: '4', semitone: 5 },
  { key: 'b', degree: '5', semitone: 7 },
  { key: 'n', degree: '6', semitone: 9 },
  { key: 'm', degree: '7', semitone: 11 },
  { key: ',', degree: 'i', semitone: 12 },
]

export function harmonicaMidi(key, octave = 'middle', sharp = false) {
  const note = harmonicaKeys.find(item => item.key === key.toLowerCase())
  if (!note) return null
  const base = octave === 'low' ? 48 : octave === 'high' ? 72 : 60
  return base + note.semitone + (sharp ? 1 : 0)
}

export function harmonicaNoteName(midi) {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

const sampleNotes = [
  ['C3', 48], ['E3', 52], ['C4', 60], ['E4', 64], ['G4', 67],
  ['C5', 72], ['E5', 76], ['G5', 79], ['C6', 84],
]
let samples = null
let sampleLoad = null

export function harmonicaSamplesReady() { return samples !== null }

export function prepareHarmonicaSamples() {
  if (samples) return Promise.resolve()
  if (sampleLoad) return sampleLoad
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!OfflineContext) return Promise.reject(new Error('Offline audio decoding is unavailable'))
  let decoder
  try { decoder = new OfflineContext(1, 44100, 44100) }
  catch (error) { return Promise.reject(error) }
  sampleLoad = Promise.all(sampleNotes.map(async ([name, midi]) => {
    const response = await fetch(`${import.meta.env.BASE_URL}audio/harmonica/${name}.mp3`)
    if (!response.ok) throw new Error(`Could not load ${name}: ${response.status}`)
    const buffer = await decoder.decodeAudioData(await response.arrayBuffer())
    const rate = buffer.sampleRate
    const data = buffer.getChannelData(0)
    const start = Math.round(0.9 * rate)
    const end = Math.min(Math.round(3.5 * rate), data.length - Math.round(0.15 * rate))
    const fadeLength = Math.round(0.07 * rate)
    // Blend the end of the sustain into an earlier section. The first pass
    // keeps the recorded attack; subsequent passes loop without a hard click.
    for (let i = 0; i < fadeLength; i++) {
      const blend = (i + 1) / fadeLength
      data[end - fadeLength + i] = data[end - fadeLength + i] * (1 - blend) + data[start + i] * blend
    }
    return { name, midi, buffer, loopStart: (start + fadeLength) / rate, loopEnd: end / rate }
  })).then(loaded => { samples = loaded }).catch(error => {
    sampleLoad = null
    throw error
  })
  return sampleLoad
}

function closestSample(midi) {
  return samples.reduce((closest, sample) => Math.abs(sample.midi - midi) < Math.abs(closest.midi - midi) ? sample : closest)
}

function createSampleHarmonicaVoice(midi, volume) {
  const ctx = audioContext()
  const began = ctx.currentTime
  const output = ctx.createGain()
  const breath = ctx.createGain()
  output.gain.value = Math.max(0, Math.min(100, volume)) / 100 * 0.5
  breath.gain.setValueAtTime(0, began)
  breath.gain.linearRampToValueAtTime(1, began + 0.5)
  breath.connect(output).connect(ctx.destination)
  let released = false
  let current

  function playSample(nextMidi) {
    const at = ctx.currentTime
    const sample = closestSample(nextMidi)
    if (current?.sample === sample) {
      current.source.playbackRate.setTargetAtTime(2 ** ((nextMidi - sample.midi) / 12), at, 0.009)
      return
    }
    const source = ctx.createBufferSource()
    const crossfade = ctx.createGain()
    source.buffer = sample.buffer
    source.loop = true
    source.loopStart = sample.loopStart
    source.loopEnd = sample.loopEnd
    source.playbackRate.value = 2 ** ((nextMidi - sample.midi) / 12)
    crossfade.gain.setValueAtTime(current ? 0 : 1, at)
    source.connect(crossfade).connect(breath)
    source.onended = () => { source.disconnect(); crossfade.disconnect() }
    // A newly pressed note keeps its natural recorded attack. When a mouse
    // modifier changes a held note, start in the sustain for an immediate retune.
    source.start(at, current ? sample.loopStart : 0)
    if (current) {
      crossfade.gain.linearRampToValueAtTime(1, at + 0.035)
      current.gain.gain.cancelScheduledValues(at)
      current.gain.gain.setValueAtTime(1, at)
      current.gain.gain.linearRampToValueAtTime(0, at + 0.035)
      current.source.stop(at + 0.05)
    }
    current = { sample, source, gain: crossfade }
  }

  playSample(midi)
  return {
    setPitch(nextMidi) { if (!released) playSample(nextMidi) },
    setVolume(nextVolume) {
      if (released) return
      output.gain.setTargetAtTime(Math.max(0, Math.min(100, nextVolume)) / 100 * 0.5, ctx.currentTime, 0.02)
    },
    release() {
      if (released) return
      released = true
      const at = ctx.currentTime
      const currentBreath = Math.min(1, Math.max(0, (at - began) / 0.5))
      breath.gain.cancelScheduledValues(at)
      breath.gain.setValueAtTime(currentBreath, at)
      breath.gain.linearRampToValueAtTime(0, at + 0.5)
      current.source.stop(at + 0.53)
      setTimeout(() => { breath.disconnect(); output.disconnect() }, 650)
    },
  }
}

// One voice stays alive while a key is held. Changing mouse modifiers bends its pitch
// without restarting the breath; attack and release each take half a second.
function createSynthHarmonicaVoice(midi, volume = 100) {
  const ctx = audioContext()
  const now = ctx.currentTime
  const output = ctx.createGain()
  const breath = ctx.createGain()
  const vibrato = ctx.createGain()
  const reed = ctx.createBiquadFilter()
  reed.type = 'lowpass'
  reed.frequency.value = 3400
  reed.Q.value = 0.7
  reed.connect(vibrato).connect(breath).connect(output).connect(ctx.destination)

  const oscillators = [
    { multiple: 1, type: 'sawtooth', level: 0.16 },
    { multiple: 2, type: 'sine', level: 0.12 },
    { multiple: 3, type: 'sine', level: 0.045 },
  ].map(partial => {
    const oscillator = ctx.createOscillator()
    const level = ctx.createGain()
    oscillator.type = partial.type
    oscillator.frequency.value = midiToFrequency(midi) * partial.multiple
    level.gain.value = partial.level
    oscillator.connect(level).connect(reed)
    oscillator.start(now)
    return { oscillator, multiple: partial.multiple }
  })

  const tremolo = ctx.createOscillator()
  const tremoloDepth = ctx.createGain()
  tremolo.frequency.value = 5.2
  tremoloDepth.gain.value = 0.07
  vibrato.gain.value = 0.93
  tremolo.connect(tremoloDepth).connect(vibrato.gain)
  tremolo.start(now)

  let released = false
  let currentVolume = Math.max(0, Math.min(100, volume))
  output.gain.value = currentVolume / 100 * 0.2
  breath.gain.setValueAtTime(0, now)
  breath.gain.linearRampToValueAtTime(1, now + 0.5)

  return {
    setPitch(nextMidi) {
      if (released) return
      const at = ctx.currentTime
      for (const { oscillator, multiple } of oscillators) {
        oscillator.frequency.cancelScheduledValues(at)
        oscillator.frequency.setTargetAtTime(midiToFrequency(nextMidi) * multiple, at, 0.009)
      }
    },
    setVolume(nextVolume) {
      if (released) return
      currentVolume = Math.max(0, Math.min(100, nextVolume))
      output.gain.setTargetAtTime(currentVolume / 100 * 0.2, ctx.currentTime, 0.02)
    },
    release() {
      if (released) return
      released = true
      const at = ctx.currentTime
      // Continue from the current breath level, even if the key is released
      // before the half-second attack reaches its peak.
      const currentBreath = Math.min(1, Math.max(0, (at - now) / 0.5))
      breath.gain.cancelScheduledValues(at)
      breath.gain.setValueAtTime(currentBreath, at)
      breath.gain.linearRampToValueAtTime(0, at + 0.5)
      for (const { oscillator } of oscillators) oscillator.stop(at + 0.53)
      tremolo.stop(at + 0.53)
      setTimeout(() => {
        tremolo.disconnect()
        tremoloDepth.disconnect()
        for (const { oscillator } of oscillators) oscillator.disconnect()
        reed.disconnect()
        vibrato.disconnect()
        breath.disconnect()
        output.disconnect()
      }, 650)
    },
  }
}

export function createHarmonicaVoice(midi, volume = 100) {
  return samples ? createSampleHarmonicaVoice(midi, volume) : createSynthHarmonicaVoice(midi, volume)
}

