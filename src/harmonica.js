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
  const base = octave === 'low' ? 36 : octave === 'high' ? 60 : 48
  return base + note.semitone + (sharp ? 1 : 0)
}

export function harmonicaNoteName(midi) {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

// One voice stays alive while a key is held. Changing mouse modifiers bends its pitch
// without restarting the breath; releasing the key leaves a short reed vibration.
export function createHarmonicaVoice(midi, volume = 100) {
  const ctx = audioContext()
  const now = ctx.currentTime
  const output = ctx.createGain()
  const vibrato = ctx.createGain()
  const reed = ctx.createBiquadFilter()
  reed.type = 'lowpass'
  reed.frequency.value = 3400
  reed.Q.value = 0.7
  reed.connect(vibrato).connect(output).connect(ctx.destination)

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
  output.gain.setValueAtTime(0.0001, now)
  output.gain.exponentialRampToValueAtTime(Math.max(0.0001, currentVolume / 100 * 0.2), now + 0.045)

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
      output.gain.setTargetAtTime(Math.max(0.0001, currentVolume / 100 * 0.2), ctx.currentTime, 0.02)
    },
    release() {
      if (released) return
      released = true
      const at = ctx.currentTime
      output.gain.cancelScheduledValues(at)
      output.gain.setValueAtTime(Math.max(0.0001, output.gain.value), at)
      output.gain.exponentialRampToValueAtTime(0.0001, at + 0.3)
      for (const { oscillator } of oscillators) oscillator.stop(at + 0.34)
      tremolo.stop(at + 0.34)
      setTimeout(() => {
        tremolo.disconnect()
        tremoloDepth.disconnect()
        for (const { oscillator } of oscillators) oscillator.disconnect()
        reed.disconnect()
        vibrato.disconnect()
        output.disconnect()
      }, 450)
    },
  }
}

