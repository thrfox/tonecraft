let context

export function audioContext() {
  if (!context) context = new (window.AudioContext || window.webkitAudioContext)()
  if (context.state === 'suspended') context.resume()
  return context
}

export function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function playInstrument(midi, instrument = 'piano', duration = 1.5) {
  const ctx = audioContext()
  const now = ctx.currentTime
  const fundamental = midiToFrequency(midi)
  const output = ctx.createGain()
  output.gain.value = 0.48
  output.connect(ctx.destination)

  const harmonics = instrument === 'guitar'
    ? [[1, 0.58], [2, 0.25], [3, 0.15], [4, 0.07]]
    : [[1, 0.55], [2, 0.19], [3, 0.13], [4, 0.07], [5, 0.035]]

  harmonics.forEach(([multiple, strength]) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = fundamental * multiple
    const attack = instrument === 'guitar' ? 0.006 : 0.012
    const decay = instrument === 'guitar' ? 0.8 : 1.3
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(strength, now + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(duration, decay))
    osc.connect(gain).connect(output)
    osc.start(now)
    osc.stop(now + Math.min(duration, decay) + 0.02)
  })
}

export function playMetronome(when, voice, intensity) {
  if (intensity === 0) return
  const ctx = audioContext()
  const gain = ctx.createGain()
  const osc = ctx.createOscillator()
  const level = [0, 0.11, 0.22, 0.35][intensity]
  const settings = {
    classic: ['sine', 1050, 0.045],
    wood: ['triangle', 650, 0.07],
    bell: ['sine', 1450, 0.22],
    digital: ['square', 900, 0.035],
    soft: ['sine', 470, 0.085],
  }
  const [type, frequency, length] = settings[voice] || settings.classic
  osc.type = type
  osc.frequency.setValueAtTime(frequency * (intensity === 3 ? 1.35 : 1), when)
  if (voice === 'wood' || voice === 'digital') {
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.65, when + length)
  }
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(level, when + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + length)
  osc.connect(gain).connect(ctx.destination)
  osc.start(when)
  osc.stop(when + length + 0.005)
}

export function detectPitch(buffer, sampleRate) {
  // YIN difference function with a clarity threshold and parabolic interpolation.
  const size = buffer.length
  let rms = 0
  for (let i = 0; i < size; i++) rms += buffer[i] * buffer[i]
  rms = Math.sqrt(rms / size)
  if (rms < 0.012) return null

  const minLag = Math.max(2, Math.floor(sampleRate / 1200))
  const maxLag = Math.min(Math.floor(sampleRate / 65), Math.floor(size / 2))
  const difference = new Float32Array(maxLag + 1)
  const normalized = new Float32Array(maxLag + 1)
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i < size - maxLag; i++) {
      const delta = buffer[i] - buffer[i + lag]
      sum += delta * delta
    }
    difference[lag] = sum
  }
  let running = 0
  for (let lag = 1; lag <= maxLag; lag++) {
    running += difference[lag]
    normalized[lag] = running ? difference[lag] * lag / running : 1
  }
  let lag = minLag
  while (lag < maxLag && normalized[lag] > 0.14) lag++
  if (lag >= maxLag) return null
  while (lag + 1 < maxLag && normalized[lag + 1] < normalized[lag]) lag++
  if (normalized[lag] > 0.2) return null
  const left = normalized[lag - 1] || normalized[lag]
  const middle = normalized[lag]
  const right = normalized[lag + 1] || normalized[lag]
  const denominator = left - 2 * middle + right
  const offset = denominator ? Math.max(-1, Math.min(1, 0.5 * (left - right) / denominator)) : 0
  return sampleRate / (lag + offset)
}
