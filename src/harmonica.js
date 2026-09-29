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

// One voice stays alive while a key is held. Changing mouse modifiers bends its pitch
// without restarting the breath; attack and release each take half a second.
export function createHarmonicaVoice(midi, volume = 100) {
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

