/**
 * Retro Sci-Fi Web Audio Synthesizer for Jetpack Jones
 * Generates satisfying plasma bubble-bursts, jetpack thrust roars, alien squelches, and pickups.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  public masterVolume: number = 0.8;
  public enabled: boolean = true;
  private jetpackGain: GainNode | null = null;
  private jetpackFilter: BiquadFilterNode | null = null;
  private jetpackNoiseNode: AudioBufferSourceNode | null = null;
  private sharedNoiseBuffer: AudioBuffer | null = null;
  private isThrusting: boolean = false;
  private isHoverMode: boolean = false;

  // Next-Gen Triple-AAA Level 3 Car Audio Synthesizer Nodes
  private carNodesReady: boolean = false;
  private carOscSub: OscillatorNode | null = null;
  private carOscMain: OscillatorNode | null = null;
  private carOscHarm: OscillatorNode | null = null;
  private carIdleLfo: OscillatorNode | null = null;
  private carIdleLfoGain: GainNode | null = null;
  private carEngineFilter: BiquadFilterNode | null = null;
  private carEngineGain: GainNode | null = null;
  private carTurboOsc: OscillatorNode | null = null;
  private carTurboGain: GainNode | null = null;
  private carScreechFilter1: BiquadFilterNode | null = null;
  private carScreechFilter2: BiquadFilterNode | null = null;
  private carScreechGain: GainNode | null = null;
  private carRumbleGain: GainNode | null = null;
  private carPrevGear: number = 1;

  constructor() {
    // Unlock AudioContext on initial browser user interaction
    const unlockAudio = () => {
      this.initCtx();
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
        window.removeEventListener('touchstart', unlockAudio);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlockAudio, { passive: true });
      window.addEventListener('keydown', unlockAudio, { passive: true });
      window.addEventListener('touchstart', unlockAudio, { passive: true });
    }
  }

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.masterGain && this.ctx) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.enabled ? this.masterVolume : 0, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (!this.sharedNoiseBuffer && this.ctx) {
      const len = Math.floor(this.ctx.sampleRate * 0.6);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.sharedNoiseBuffer = buf;
    }
  }

  public get outputNode(): AudioNode {
    if (!this.ctx || !this.masterGain) {
      this.initCtx();
    }
    return this.masterGain || this.ctx!.destination;
  }

  public setVolume(vol: number) {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && this.enabled) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }
  }

  public toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.enabled ? this.masterVolume : 0, this.ctx.currentTime);
    }
    if (!this.enabled && this.jetpackGain) {
      this.jetpackGain.gain.setValueAtTime(0, this.ctx?.currentTime || 0);
    }
    return this.enabled;
  }

  /**
   * Epic Jetpack thruster roar with combustion rumble & distinct warm hover-stabilizer hum during 1s hang!
   */
  public setJetpackThrust(active: boolean, hoverMode: boolean = false) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    if (active && (!this.isThrusting || this.isHoverMode !== hoverMode)) {
      this.isThrusting = true;
      this.isHoverMode = hoverMode;

      if (!this.jetpackGain) {
        const bufferSize = this.ctx.sampleRate * 2;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          output[i] = (b0 + b1 + b2) * 0.22;
        }

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 750;
        filter.Q.value = 2.4;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, t);

        const noise = this.ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        noise.loop = true;

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.outputNode);
        noise.start(t);

        this.jetpackFilter = filter;
        this.jetpackGain = gain;
        this.jetpackNoiseNode = noise;
      }

      if (this.jetpackFilter) {
        this.jetpackFilter.frequency.cancelScheduledValues(t);
        this.jetpackFilter.frequency.linearRampToValueAtTime(hoverMode ? 340 : 780, t + 0.12);
        this.jetpackFilter.Q.linearRampToValueAtTime(hoverMode ? 4.2 : 2.4, t + 0.12);
      }

      this.jetpackGain.gain.cancelScheduledValues(t);
      this.jetpackGain.gain.linearRampToValueAtTime(hoverMode ? 0.18 : 0.32, t + 0.10);

    } else if (!active && this.isThrusting) {
      this.isThrusting = false;
      this.isHoverMode = false;
      if (this.jetpackGain && this.ctx) {
        this.jetpackGain.gain.cancelScheduledValues(t);
        this.jetpackGain.gain.linearRampToValueAtTime(0.0001, t + 0.2);
      }
    }
  }

  /**
   * Dimensional Portal Warp SFX (8-bit arpeggio synth entering Pixel Realm, shimmering chord returning to HD!)
   */
  public playPortalWarp(enteringPixel: boolean) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const notes = enteringPixel ? [330, 440, 660, 880, 1320] : [880, 660, 523, 392];
    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = enteringPixel ? 'square' : 'sine';
      const st = t + idx * 0.045;
      osc.frequency.setValueAtTime(freq, st);
      gain.gain.setValueAtTime(0.001, st);
      gain.gain.linearRampToValueAtTime(enteringPixel ? 0.14 : 0.18, st + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, st + 0.18);
      osc.connect(gain);
      gain.connect(this.outputNode);
      osc.start(st);
      osc.stop(st + 0.19);
    });
  }

  /**
   * Triple-AAA Retro-Sci-Fi Colt Plasma Blaster SFX
   * Combines a crisp mechanical snap, resonant dual-oscillator Star-Wars/1979 laser sweep, and sub-bass plasma kick!
   */
  public playLaser() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const pitchJitter = 0.94 + Math.random() * 0.12;

    // 1. Resonant Dual-Oscillator Sci-Fi Laser Sweep (rich harmonic pew!)
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(6.5, t);
    filter.frequency.setValueAtTime(4200 * pitchJitter, t);
    filter.frequency.exponentialRampToValueAtTime(320, t + 0.17);

    const laserGain = this.ctx.createGain();
    laserGain.gain.setValueAtTime(0.001, t);
    laserGain.gain.linearRampToValueAtTime(0.26, t + 0.005);
    laserGain.gain.exponentialRampToValueAtTime(0.001, t + 0.19);

    const oscA = this.ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.setValueAtTime(1680 * pitchJitter, t);
    oscA.frequency.exponentialRampToValueAtTime(210 * pitchJitter, t + 0.16);

    const oscB = this.ctx.createOscillator();
    oscB.type = 'square';
    oscB.frequency.setValueAtTime(1260 * pitchJitter, t);
    oscB.frequency.exponentialRampToValueAtTime(155 * pitchJitter, t + 0.16);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(laserGain);
    laserGain.connect(this.outputNode);
    oscA.start(t);
    oscB.start(t);
    oscA.stop(t + 0.20);
    oscB.stop(t + 0.20);

    // 2. High-energy Plasma Snap / Revolver Hammer Crack (filtered noise transient)
    const snapDur = 0.045;
    const snapLen = Math.max(1, Math.floor(this.ctx.sampleRate * snapDur));
    const snapBuf = this.ctx.createBuffer(1, snapLen, this.ctx.sampleRate);
    const snapData = snapBuf.getChannelData(0);
    for (let i = 0; i < snapLen; i++) {
      snapData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / snapLen, 2.4);
    }
    const snapSrc = this.ctx.createBufferSource();
    snapSrc.buffer = snapBuf;
    const snapFilter = this.ctx.createBiquadFilter();
    snapFilter.type = 'bandpass';
    snapFilter.frequency.setValueAtTime(2600, t);
    snapFilter.Q.setValueAtTime(1.4, t);
    const snapGain = this.ctx.createGain();
    snapGain.gain.setValueAtTime(0.28, t);
    snapGain.gain.exponentialRampToValueAtTime(0.001, t + snapDur);
    snapSrc.connect(snapFilter);
    snapFilter.connect(snapGain);
    snapGain.connect(this.outputNode);
    snapSrc.start(t);

    // 3. Punchy Sub-Bass Plasma Kick (gives the Colt Peacemaker real weight!)
    const kickOsc = this.ctx.createOscillator();
    const kickGain = this.ctx.createGain();
    kickOsc.type = 'sine';
    kickOsc.frequency.setValueAtTime(195, t);
    kickOsc.frequency.exponentialRampToValueAtTime(42, t + 0.095);
    kickGain.gain.setValueAtTime(0.32, t);
    kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    kickOsc.connect(kickGain);
    kickGain.connect(this.outputNode);
    kickOsc.start(t);
    kickOsc.stop(t + 0.11);
  }

  /**
   * Triple-AAA Jump & Double-Jump Sound Effects
   * - 1st Jump: Crisp athletic boot-spring pop + upward air whoosh
   * - 2nd Jump (Double Jump): Distinct 1979 micro-jetpack pneumatic plasma pulse!
   */
  public playJump(isDoubleJump: boolean = false) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    if (!isDoubleJump) {
      // 1st Jump: Crisp upward athletic lift sweep
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(155 + Math.random() * 18, t);
      osc.frequency.exponentialRampToValueAtTime(430, t + 0.11);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.20, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

      osc.connect(gain);
      gain.connect(this.outputNode);
      osc.start(t);
      osc.stop(t + 0.14);

      // Subtle airy boot push-off whoosh
      const dur = 0.09;
      const nLen = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const nBuf = this.ctx.createBuffer(1, nLen, this.ctx.sampleRate);
      const data = nBuf.getChannelData(0);
      for (let i = 0; i < nLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.sin((i / nLen) * Math.PI);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = nBuf;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.setValueAtTime(900, t);
      hp.frequency.exponentialRampToValueAtTime(2200, t + dur);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.10, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(hp);
      hp.connect(ng);
      ng.connect(this.outputNode);
      src.start(t);
    } else {
      // 2nd Jump (Double Jump): Crisp 1979 micro-jetpack pneumatic plasma boost!
      const boostOsc = this.ctx.createOscillator();
      const boostGain = this.ctx.createGain();
      boostOsc.type = 'sine';
      boostOsc.frequency.setValueAtTime(230, t);
      boostOsc.frequency.exponentialRampToValueAtTime(690, t + 0.14);

      boostGain.gain.setValueAtTime(0.001, t);
      boostGain.gain.linearRampToValueAtTime(0.24, t + 0.012);
      boostGain.gain.exponentialRampToValueAtTime(0.001, t + 0.17);

      boostOsc.connect(boostGain);
      boostGain.connect(this.outputNode);
      boostOsc.start(t);
      boostOsc.stop(t + 0.18);

      // Harmonic shimmer overtone
      const chime = this.ctx.createOscillator();
      const chimeGain = this.ctx.createGain();
      chime.type = 'triangle';
      chime.frequency.setValueAtTime(480, t);
      chime.frequency.exponentialRampToValueAtTime(960, t + 0.12);
      chimeGain.gain.setValueAtTime(0.11, t);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      chime.connect(chimeGain);
      chimeGain.connect(this.outputNode);
      chime.start(t);
      chime.stop(t + 0.15);

      // Pneumatic thruster air-jet burst
      const dur = 0.14;
      const nLen = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const nBuf = this.ctx.createBuffer(1, nLen, this.ctx.sampleRate);
      const data = nBuf.getChannelData(0);
      for (let i = 0; i < nLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 1.5);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = nBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1400, t);
      bp.frequency.exponentialRampToValueAtTime(520, t + dur);
      bp.Q.setValueAtTime(1.2, t);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.24, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(this.outputNode);
      src.start(t);
    }
  }

  /**
   * Triple-AAA Running Slide SFX
   * Combines an initial drop-in boot thump, sweeping metallic/gravel friction skid, and subtle spark crackle!
   */
  public playSlide() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const dur = 0.88;

    // 1. Punchy drop-in knee/boot plant thump
    const dropOsc = this.ctx.createOscillator();
    const dropGain = this.ctx.createGain();
    dropOsc.type = 'sine';
    dropOsc.frequency.setValueAtTime(155, t);
    dropOsc.frequency.exponentialRampToValueAtTime(40, t + 0.11);
    dropGain.gain.setValueAtTime(0.38, t);
    dropGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    dropOsc.connect(dropGain);
    dropGain.connect(this.outputNode);
    dropOsc.start(t);
    dropOsc.stop(t + 0.13);

    // 2. Loud sustained sweeping friction skid (bandpass-filtered noise)
    const sampleCount = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const skidBuf = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const data = skidBuf.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      const p = i / sampleCount;
      const env = Math.min(1, p * 14) * Math.pow(1 - p, 1.15);
      const grit = 0.78 + 0.22 * Math.sin(i * 0.09);
      data[i] = (Math.random() * 2 - 1) * env * grit;
    }

    const skidSrc = this.ctx.createBufferSource();
    skidSrc.buffer = skidBuf;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1900, t);
    bp.frequency.exponentialRampToValueAtTime(460, t + dur);
    bp.Q.setValueAtTime(1.2, t);

    const skidGain = this.ctx.createGain();
    skidGain.gain.setValueAtTime(0.54, t);
    skidGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    skidSrc.connect(bp);
    bp.connect(skidGain);
    skidGain.connect(this.outputNode);
    skidSrc.start(t);

    // 3. Crisp loud metallic boot-spark sizzle
    const sparkDur = 0.52;
    const sparkLen = Math.max(1, Math.floor(this.ctx.sampleRate * sparkDur));
    const sparkBuf = this.ctx.createBuffer(1, sparkLen, this.ctx.sampleRate);
    const sData = sparkBuf.getChannelData(0);
    for (let i = 0; i < sparkLen; i++) {
      const p = i / sparkLen;
      sData[i] = (Math.random() < 0.24 ? (Math.random() * 2 - 1) : 0) * (1 - p);
    }
    const sparkSrc = this.ctx.createBufferSource();
    sparkSrc.buffer = sparkBuf;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(3200, t);
    const sparkGain = this.ctx.createGain();
    sparkGain.gain.setValueAtTime(0.28, t);
    sparkGain.gain.exponentialRampToValueAtTime(0.001, t + sparkDur);
    sparkSrc.connect(hp);
    hp.connect(sparkGain);
    sparkGain.connect(this.outputNode);
    sparkSrc.start(t);
  }

  private footstepSideFlip: boolean = false;

  /**
   * Procedural player footstep sound effect — accurate to Walking, Running & Crouch-Walking!
   * Alternating left/right 1979 space-boot heel-strike + deck-plate thud + filtered grit scuff
   */
  public playFootstep(mode: 'walk' | 'run' | 'crouch' = 'walk') {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    this.footstepSideFlip = !this.footstepSideFlip;
    const sidePitch = this.footstepSideFlip ? 1.04 : 0.95;

    const isRun = mode === 'run';
    const isCrouch = mode === 'crouch';

    const thudGainPeak = isRun ? 0.28 : (isCrouch ? 0.085 : 0.16);
    const clickGainPeak = isRun ? 0.16 : (isCrouch ? 0.045 : 0.095);
    const noiseGainPeak = isRun ? 0.14 : (isCrouch ? 0.04 : 0.075);

    // 1. Sub-bass space-boot deck thud (heavier & punchier when running!)
    const thudOsc = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thudOsc.type = 'sine';
    const baseLow = (isRun ? 132 : (isCrouch ? 92 : 112)) * sidePitch + (Math.random() - 0.5) * 10;
    thudOsc.frequency.setValueAtTime(baseLow, t);
    thudOsc.frequency.exponentialRampToValueAtTime(isRun ? 38 : 44, t + (isRun ? 0.075 : 0.06));

    thudGain.gain.setValueAtTime(thudGainPeak, t);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + (isRun ? 0.085 : 0.068));

    thudOsc.connect(thudGain);
    thudGain.connect(this.outputNode);
    thudOsc.start(t);
    thudOsc.stop(t + 0.09);

    // 2. Crisp metallic deck-plate boot heel click
    const clickOsc = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    clickOsc.type = 'triangle';
    const baseHigh = (isRun ? 440 : (isCrouch ? 240 : 340)) * sidePitch + Math.random() * 45;
    clickOsc.frequency.setValueAtTime(baseHigh, t);
    clickOsc.frequency.exponentialRampToValueAtTime(85, t + 0.038);

    clickGain.gain.setValueAtTime(clickGainPeak, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    clickOsc.connect(clickGain);
    clickGain.connect(this.outputNode);
    clickOsc.start(t);
    clickOsc.stop(t + 0.045);

    // 3. Short band-passed boot sole grit/scuff transient (reuses pre-allocated sharedNoiseBuffer = 0 GC!)
    if (this.sharedNoiseBuffer) {
      const dur = isRun ? 0.045 : 0.036;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.sharedNoiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime((isRun ? 1650 : 1200) * sidePitch, t);
      filter.Q.setValueAtTime(1.6, t);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(noiseGainPeak, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.outputNode);
    noise.start(t, Math.random() * 0.4, dur);
    }
  }

  /**
   * Subtle retro CRT TV white-noise static burst when a monitor flashes "TEST SIGNAL LOST"
   */
  public playCrtStaticNoise(durationSec: number = 0.35) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx || !this.sharedNoiseBuffer) return;

    const t = this.ctx.currentTime;
    const dur = Math.max(0.14, Math.min(0.55, durationSec));
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.sharedNoiseBuffer;
    noise.loop = true;

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1800, t);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(4200, t);
    bp.Q.setValueAtTime(0.7, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.055, t + 0.025);
    gain.gain.setValueAtTime(0.048, t + dur * 0.72);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);

    noise.connect(hp);
    hp.connect(bp);
    bp.connect(gain);
    gain.connect(this.outputNode);
    noise.start(t, Math.random() * 0.3, dur);
  }

  /**
   * Triple-AAA Jump Ground Landing SFX
   * Velocity-scaled sub-bass boot thump + filtered gravel/dust scuff + subtle gear clack
   */
  public playGroundLanding(impactStrength: number = 0.65) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const s = Math.max(0.25, Math.min(1.0, impactStrength));
    const t = this.ctx.currentTime;

    // 1. Weighty sub-bass boot-plant thump
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(130 + s * 35 + Math.random() * 14, t);
    subOsc.frequency.exponentialRampToValueAtTime(34, t + 0.11 + s * 0.05);

    subGain.gain.setValueAtTime(0.001, t);
    subGain.gain.linearRampToValueAtTime(0.24 + s * 0.22, t + 0.008);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.13 + s * 0.06);

    subOsc.connect(subGain);
    subGain.connect(this.outputNode);
    subOsc.start(t);
    subOsc.stop(t + 0.21);

    // 2. Crisp boot-sole / retro gear impact transient
    const soleOsc = this.ctx.createOscillator();
    const soleGain = this.ctx.createGain();
    soleOsc.type = 'triangle';
    soleOsc.frequency.setValueAtTime(240 + Math.random() * 55, t);
    soleOsc.frequency.exponentialRampToValueAtTime(72, t + 0.055);

    soleGain.gain.setValueAtTime(0.11 + s * 0.10, t);
    soleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    soleOsc.connect(soleGain);
    soleGain.connect(this.outputNode);
    soleOsc.start(t);
    soleOsc.stop(t + 0.065);

    // 3. Bandpass-filtered ground dust/gravel scuff burst
    const dur = 0.085 + s * 0.055;
    const sampleCount = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const noiseBuf = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      const env = Math.pow(1 - i / sampleCount, 1.8);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(750 + s * 450, t);
    filter.Q.setValueAtTime(1.1, t);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.14 + s * 0.16, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noiseSrc.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.outputNode);
    noiseSrc.start(t);
  }

  /**
   * Satisfying Juicy Alien Blob Squish Explosion Pop & Splatter
   */
  public playAlienSquish() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // 1. Wet Pop Transient
    const popOsc = this.ctx.createOscillator();
    const popGain = this.ctx.createGain();
    popOsc.type = 'sine';
    popOsc.frequency.setValueAtTime(950, t);
    popOsc.frequency.exponentialRampToValueAtTime(160, t + 0.12);

    popGain.gain.setValueAtTime(0.35, t);
    popGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    popOsc.connect(popGain);
    popGain.connect(this.outputNode);
    popOsc.start(t);
    popOsc.stop(t + 0.13);

    // 2. Bubbly Squelch & Gurgle
    const squelchOsc = this.ctx.createOscillator();
    const squelchGain = this.ctx.createGain();
    squelchOsc.type = 'triangle';
    squelchOsc.frequency.setValueAtTime(320, t);
    squelchOsc.frequency.linearRampToValueAtTime(680, t + 0.06);
    squelchOsc.frequency.exponentialRampToValueAtTime(80, t + 0.22);

    squelchGain.gain.setValueAtTime(0.28, t);
    squelchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

    squelchOsc.connect(squelchGain);
    squelchGain.connect(this.outputNode);
    squelchOsc.start(t);
    squelchOsc.stop(t + 0.23);

    // 3. Sub-Bass Splatter Thump
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(140, t);
    subOsc.frequency.exponentialRampToValueAtTime(30, t + 0.18);

    subGain.gain.setValueAtTime(0.3, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    subOsc.connect(subGain);
    subGain.connect(this.outputNode);
    subOsc.start(t);
    subOsc.stop(t + 0.19);

    // 4. Energetic Sci-Fi Disintegration Zap & Sizzle
    const zapOsc = this.ctx.createOscillator();
    const zapGain = this.ctx.createGain();
    zapOsc.type = 'sawtooth';
    zapOsc.frequency.setValueAtTime(1200, t);
    zapOsc.frequency.exponentialRampToValueAtTime(150, t + 0.25);

    zapGain.gain.setValueAtTime(0.22, t);
    zapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    zapOsc.connect(zapGain);
    zapGain.connect(this.outputNode);
    zapOsc.start(t);
    zapOsc.stop(t + 0.26);
  }

  /**
   * Energetic Sci-Fi Laser & Rubbery Splat Impact on Enemy Hit
   */
  public playEnemyImpact() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // 1. High-frequency plasma sizzle/zap transient
    const zapOsc = this.ctx.createOscillator();
    const zapGain = this.ctx.createGain();
    zapOsc.type = 'sawtooth';
    zapOsc.frequency.setValueAtTime(1400 + Math.random() * 200, t);
    zapOsc.frequency.exponentialRampToValueAtTime(320, t + 0.045);

    zapGain.gain.setValueAtTime(0.24, t);
    zapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

    zapOsc.connect(zapGain);
    zapGain.connect(this.outputNode);
    zapOsc.start(t);
    zapOsc.stop(t + 0.05);

    // 2. Juicy rubbery membrane slap
    const slapOsc = this.ctx.createOscillator();
    const slapGain = this.ctx.createGain();
    slapOsc.type = 'sine';
    slapOsc.frequency.setValueAtTime(280 + Math.random() * 40, t);
    slapOsc.frequency.exponentialRampToValueAtTime(65, t + 0.07);

    slapGain.gain.setValueAtTime(0.28, t);
    slapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

    slapOsc.connect(slapGain);
    slapGain.connect(this.outputNode);
    slapOsc.start(t);
    slapOsc.stop(t + 0.075);
  }

  /**
   * Heavy blunt impact sound for ragdoll knockback
   */
  public playHitImpact() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.22);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

    osc.connect(gain);
    gain.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + 0.23);
  }

  /**
   * Heavy Hydraulic Press Crushing Slam & Metal Crunch
   */
  public playCrushHit() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // 1. Heavy metal slam
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.35);

    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc.connect(gain);
    gain.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + 0.36);

    // 2. High-frequency metal crunch / clang
    const clang = this.ctx.createOscillator();
    const clangGain = this.ctx.createGain();
    clang.type = 'sawtooth';
    clang.frequency.setValueAtTime(820, t);
    clang.frequency.exponentialRampToValueAtTime(110, t + 0.15);

    clangGain.gain.setValueAtTime(0.3, t);
    clangGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    clang.connect(clangGain);
    clangGain.connect(this.outputNode);
    clang.start(t);
    clang.stop(t + 0.16);
  }

  public playExplosion() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(25, t + 0.4);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

    osc.connect(gain);
    gain.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + 0.42);
  }

  public playPickup() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, t); // D5
    osc.frequency.setValueAtTime(880.00, t + 0.08); // A5
    osc.frequency.setValueAtTime(1174.66, t + 0.16); // D6

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc.connect(gain);
    gain.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + 0.36);
  }

  public playCoin() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc2.type = 'triangle';
    osc.frequency.setValueAtTime(1318.51, t); // E6
    osc.frequency.setValueAtTime(1760.00, t + 0.08); // A6
    osc2.frequency.setValueAtTime(2637.02, t + 0.08); // E7 harmonic

    gain.gain.setValueAtTime(0.24, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(this.outputNode);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + 0.46);
    osc2.stop(t + 0.46);
  }

  public playShieldToggle(active: boolean) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    if (active) {
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.exponentialRampToValueAtTime(1174.66, t + 0.22);
    } else {
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    }

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(gain);
    gain.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  public playShieldDeflect() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const gain = this.ctx.createGain();

    // FM Wobble: 620Hz base with 28Hz wobble vibrato
    osc.type = 'sine';
    osc.frequency.setValueAtTime(620, t);
    osc.frequency.exponentialRampToValueAtTime(280, t + 0.28);

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(28, t);
    lfoGain.gain.setValueAtTime(140, t);

    lfo.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + 0.30);

    gain.gain.setValueAtTime(0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.30);

    osc.connect(gain);
    gain.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + 0.31);
  }

  public playWarning() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    osc.connect(gain);
    gain.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /**
   * Cartoony retro sci-fi radio wave transmission ping/chirp
   */
  public playRadioWavePing() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1480, t);
    osc.frequency.exponentialRampToValueAtTime(2450, t + 0.12);

    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(gain);
    gain.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /**
   * Cataclysmic Meteor impact shatter sound (deep seismic thud + glassy/metallic crack)
   */
  public playMeteorShatter(isCrystal: boolean = false) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // Deep seismic impact boom
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(120, t);
    subOsc.frequency.exponentialRampToValueAtTime(32, t + 0.38);

    subGain.gain.setValueAtTime(0.35, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.40);
    subOsc.connect(subGain);
    subGain.connect(this.outputNode);
    subOsc.start(t);
    subOsc.stop(t + 0.42);

    // Crackle / shatter transient
    const highOsc = this.ctx.createOscillator();
    const highGain = this.ctx.createGain();
    highOsc.type = isCrystal ? 'sine' : 'sawtooth';
    highOsc.frequency.setValueAtTime(isCrystal ? 1800 : 450, t);
    highOsc.frequency.exponentialRampToValueAtTime(isCrystal ? 600 : 80, t + 0.25);

    highGain.gain.setValueAtTime(0.22, t);
    highGain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    highOsc.connect(highGain);
    highGain.connect(this.outputNode);
    highOsc.start(t);
    highOsc.stop(t + 0.30);
  }

  /**
   * Soft vintage radio crackle static with squelch and incoming planet sediment alert
   */
  public playRadioCrackleSedimentWarning() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // 1. Soft Bandpassed White Noise Radio Crackle with micro-dropouts
    const bufferSize = Math.floor(this.ctx.sampleRate * 1.8);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const pop = Math.random() < 0.04 ? (Math.random() - 0.5) * 1.4 : (Math.random() - 0.5) * 0.22;
      output[i] = pop;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(1400, t);
    bandpass.Q.setValueAtTime(1.8, t);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.01, t);
    noiseGain.gain.linearRampToValueAtTime(0.08, t + 0.1);
    noiseGain.gain.setValueAtTime(0.06, t + 1.2);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 1.8);

    whiteNoise.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(this.outputNode);
    whiteNoise.start(t);
    whiteNoise.stop(t + 1.8);

    // 2. Comms Radio Chirp Beep (Squelch open & alert chime)
    const chirp = this.ctx.createOscillator();
    const chirpGain = this.ctx.createGain();
    chirp.type = 'sine';
    chirp.frequency.setValueAtTime(820, t + 0.05);
    chirp.frequency.setValueAtTime(1150, t + 0.15);
    chirpGain.gain.setValueAtTime(0.05, t + 0.05);
    chirpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    chirp.connect(chirpGain);
    chirpGain.connect(this.outputNode);
    chirp.start(t + 0.05);
    chirp.stop(t + 0.36);

    // 3. Spoken Comms Transmission: "Warning - incoming planet sediment"
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance('Warning: incoming planet sediment');
        utterance.rate = 1.05;
        utterance.pitch = 0.95;
        utterance.volume = 0.9;
        window.speechSynthesis.speak(utterance);
      } catch (e) {}
    }
  }

  /**
   * Resonant springy sci-fi rubbery boing sound for Bouncy Bubble Ball
   */
  public playBallBounce(strength: number = 1.0) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    const baseFreq = 160 + Math.min(200, strength * 15);
    osc.frequency.setValueAtTime(baseFreq * 0.75, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.8, t + 0.06);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.85, t + 0.22);

    const vol = Math.min(0.28, 0.10 + strength * 0.02);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

    osc.connect(gain);
    gain.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  /**
   * Initializes persistent zero-click WebAudio graph for the Level 3 Arcade Drift Car:
   * - Multi-harmonic V8 muscle/sport idle + RPM synth with dynamic resonant low-pass filter & 7.2Hz idle cam lope
   * - Spooling turbocharger whine
   * - Dual-bandpass resonant tire screech / hard-brake squeal
   * - Raised FIA curb rumble-strip thump
   */
  private initCarAudioGraph() {
    if (this.carNodesReady || !this.ctx) return;
    const t = this.ctx.currentTime;

    // Ensure shared noise buffer exists
    if (!this.sharedNoiseBuffer) {
      const len = Math.floor(this.ctx.sampleRate * 2.0);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.sharedNoiseBuffer = buf;
    }

    // 1. Multi-harmonic Engine Core
    this.carEngineFilter = this.ctx.createBiquadFilter();
    this.carEngineFilter.type = 'lowpass';
    this.carEngineFilter.frequency.setValueAtTime(220, t);
    this.carEngineFilter.Q.setValueAtTime(2.6, t);

    this.carEngineGain = this.ctx.createGain();
    this.carEngineGain.gain.setValueAtTime(0.0001, t);

    this.carOscSub = this.ctx.createOscillator();
    this.carOscSub.type = 'triangle';
    this.carOscSub.frequency.setValueAtTime(42, t);
    const subMix = this.ctx.createGain();
    subMix.gain.setValueAtTime(0.65, t);
    this.carOscSub.connect(subMix);
    subMix.connect(this.carEngineFilter);

    this.carOscMain = this.ctx.createOscillator();
    this.carOscMain.type = 'sawtooth';
    this.carOscMain.frequency.setValueAtTime(56, t);
    const mainMix = this.ctx.createGain();
    mainMix.gain.setValueAtTime(0.42, t);
    this.carOscMain.connect(mainMix);
    mainMix.connect(this.carEngineFilter);

    this.carOscHarm = this.ctx.createOscillator();
    this.carOscHarm.type = 'sawtooth';
    this.carOscHarm.frequency.setValueAtTime(112, t);
    const harmMix = this.ctx.createGain();
    harmMix.gain.setValueAtTime(0.24, t);
    this.carOscHarm.connect(harmMix);
    harmMix.connect(this.carEngineFilter);

    // Subtle 7.2 Hz V8 idle cam-lope modulation on filter cutoff
    this.carIdleLfo = this.ctx.createOscillator();
    this.carIdleLfo.type = 'sine';
    this.carIdleLfo.frequency.setValueAtTime(7.2, t);
    this.carIdleLfoGain = this.ctx.createGain();
    this.carIdleLfoGain.gain.setValueAtTime(38, t);
    this.carIdleLfo.connect(this.carIdleLfoGain);
    this.carIdleLfoGain.connect(this.carEngineFilter.frequency);

    this.carEngineFilter.connect(this.carEngineGain);
    this.carEngineGain.connect(this.outputNode);

    this.carOscSub.start(t);
    this.carOscMain.start(t);
    this.carOscHarm.start(t);
    this.carIdleLfo.start(t);

    // 2. Spooling Turbocharger Whine
    this.carTurboOsc = this.ctx.createOscillator();
    this.carTurboOsc.type = 'sine';
    this.carTurboOsc.frequency.setValueAtTime(720, t);
    this.carTurboGain = this.ctx.createGain();
    this.carTurboGain.gain.setValueAtTime(0.0001, t);
    this.carTurboOsc.connect(this.carTurboGain);
    this.carTurboGain.connect(this.outputNode);
    this.carTurboOsc.start(t);

    // 3. Realistic Gritty Asphalt Tire-Scrub + Brake/Handbrake Bite (NO synthetic high-pitched whistle!)
    const screechSrc = this.ctx.createBufferSource();
    screechSrc.buffer = this.sharedNoiseBuffer;
    screechSrc.loop = true;

    // Layer A: Heavy low-mid rubber-on-tarmac scrub roar (420-680 Hz, broad Q = 1.4)
    this.carScreechFilter1 = this.ctx.createBiquadFilter();
    this.carScreechFilter1.type = 'bandpass';
    this.carScreechFilter1.frequency.setValueAtTime(520, t);
    this.carScreechFilter1.Q.setValueAtTime(1.4, t);

    // Layer B: Authentic warm street-tire bark/chirp (960-1280 Hz, moderate Q = 3.4)
    this.carScreechFilter2 = this.ctx.createBiquadFilter();
    this.carScreechFilter2.type = 'bandpass';
    this.carScreechFilter2.frequency.setValueAtTime(1040, t);
    this.carScreechFilter2.Q.setValueAtTime(3.4, t);

    const scrubMix = this.ctx.createGain();
    scrubMix.gain.setValueAtTime(0.85, t);
    const chirpMix = this.ctx.createGain();
    chirpMix.gain.setValueAtTime(0.45, t);

    this.carScreechGain = this.ctx.createGain();
    this.carScreechGain.gain.setValueAtTime(0.0001, t);

    screechSrc.connect(this.carScreechFilter1);
    screechSrc.connect(this.carScreechFilter2);
    this.carScreechFilter1.connect(scrubMix);
    this.carScreechFilter2.connect(chirpMix);
    scrubMix.connect(this.carScreechGain);
    chirpMix.connect(this.carScreechGain);
    this.carScreechGain.connect(this.outputNode);
    screechSrc.start(t);

    // 4. Raised FIA Curb Rumble-Strip Thump
    const rumbleSrc = this.ctx.createBufferSource();
    rumbleSrc.buffer = this.sharedNoiseBuffer;
    rumbleSrc.loop = true;
    const rumbleLp = this.ctx.createBiquadFilter();
    rumbleLp.type = 'bandpass';
    rumbleLp.frequency.setValueAtTime(98, t);
    rumbleLp.Q.setValueAtTime(2.2, t);
    this.carRumbleGain = this.ctx.createGain();
    this.carRumbleGain.gain.setValueAtTime(0.0001, t);
    rumbleSrc.connect(rumbleLp);
    rumbleLp.connect(this.carRumbleGain);
    this.carRumbleGain.connect(this.outputNode);
    rumbleSrc.start(t);

    this.carNodesReady = true;
  }

  public updateCarAudio(
    active: boolean,
    speedKmh: number,
    throttle: number,
    brake: number,
    driftAmount: number,
    isBoosting: boolean,
    onCurbIntensity: number,
    isAirborne: boolean = false
  ) {
    if (!active || !this.enabled) {
      this.stopCarAudio();
      return;
    }
    this.initCtx();
    if (!this.ctx) return;
    if (!this.carNodesReady) this.initCarAudioGraph();
    if (!this.carEngineGain || !this.carEngineFilter || !this.carOscSub || !this.carOscMain || !this.carOscHarm) return;

    const t = this.ctx.currentTime;
    const spd = Math.max(0, speedKmh);

    // Simulated 5-speed automatic transmission for authentic sports-car RPM sweep!
    let gear = 1;
    let gearMin = 0, gearMax = 38;
    if (spd > 125) { gear = 5; gearMin = 115; gearMax = 175; }
    else if (spd > 92) { gear = 4; gearMin = 84; gearMax = 135; }
    else if (spd > 62) { gear = 3; gearMin = 54; gearMax = 100; }
    else if (spd > 34) { gear = 2; gearMin = 28; gearMax = 68; }

    if (gear > this.carPrevGear && throttle > 0.3) {
      this.playExhaustPop();
    }
    this.carPrevGear = gear;

    const gearNorm = Math.max(0, Math.min(1, (spd - gearMin) / Math.max(1, gearMax - gearMin)));
    const revBoost = isAirborne && throttle > 0.2 ? 0.35 : 0;
    const rpmNorm = Math.min(1.15, 0.08 + gearNorm * 0.78 + throttle * 0.16 + (isBoosting ? 0.15 : 0) + revBoost);

    // Rich V8 idle purr (~40-56 Hz) ramping smoothly into high-RPM scream (~160-240 Hz)
    const baseFreq = 44 + rpmNorm * 138;
    this.carOscSub.frequency.setTargetAtTime(baseFreq * 0.52, t, 0.045);
    this.carOscMain.frequency.setTargetAtTime(baseFreq, t, 0.04);
    this.carOscHarm.frequency.setTargetAtTime(baseFreq * 1.98, t, 0.04);

    // Idle cam-lope strong at standstill, smooths out cleanly at higher RPM
    const idleFactor = Math.max(0, 1.0 - spd / 22.0);
    if (this.carIdleLfo && this.carIdleLfoGain) {
      this.carIdleLfo.frequency.setTargetAtTime(7.2 + rpmNorm * 14.0, t, 0.05);
      this.carIdleLfoGain.gain.setTargetAtTime(idleFactor * 44.0 + 10.0, t, 0.06);
    }

    // Dynamic filter opens dramatically when you floor the throttle or hit turbo!
    const cutoff = 185 + rpmNorm * 680 + throttle * 420 + (isBoosting ? 550 : 0);
    this.carEngineFilter.frequency.setTargetAtTime(cutoff, t, 0.045);

    const engVol = 0.095 + throttle * 0.075 + rpmNorm * 0.055 + (isBoosting ? 0.04 : 0);
    this.carEngineGain.gain.setTargetAtTime(engVol, t, 0.05);

    // Spooling Turbo Whine
    if (this.carTurboOsc && this.carTurboGain) {
      const turboFreq = 680 + rpmNorm * 1450 + (isBoosting ? 520 : 0);
      const turboVol = (throttle > 0.25 || isBoosting) ? (0.008 + rpmNorm * 0.022 + (isBoosting ? 0.032 : 0)) : 0.0001;
      this.carTurboOsc.frequency.setTargetAtTime(turboFreq, t, 0.06);
      this.carTurboGain.gain.setTargetAtTime(turboVol, t, 0.07);
    }

    // Realistic Gritty Asphalt Brake Scrub & Handbrake Tire Bark
    if (this.carScreechGain && this.carScreechFilter1 && this.carScreechFilter2) {
      const hardBrake = (brake > 0.30 && spd > 14 && !isAirborne) ? Math.min(1, (spd - 12) / 55) * 0.68 : 0;
      const slipAudio = isAirborne ? 0 : Math.max(driftAmount, hardBrake);
      const screechVol = slipAudio > 0.16 && spd > 8 ? Math.min(0.28, (slipAudio - 0.14) * 0.32) : 0.0001;
      // Lower, meatier rubber-on-asphalt scrub during normal braking; sharper bark during high-speed handbrake drift!
      const isBrakingOnly = hardBrake > driftAmount;
      const f1 = isBrakingOnly ? (420 + Math.min(160, spd * 1.1)) : (540 + Math.min(220, spd * 1.5));
      const f2 = isBrakingOnly ? (820 + Math.min(180, spd * 1.2)) : (1020 + Math.min(340, spd * 2.2) + slipAudio * 140);
      this.carScreechFilter1.frequency.setTargetAtTime(f1, t, 0.05);
      this.carScreechFilter2.frequency.setTargetAtTime(f2, t, 0.05);
      this.carScreechGain.gain.setTargetAtTime(screechVol, t, 0.04);
    }

    // Raised FIA Curb Rumble-Strip Thump
    if (this.carRumbleGain) {
      const rumbleVol = (!isAirborne && onCurbIntensity > 0.05 && spd > 5)
        ? Math.min(0.32, onCurbIntensity * (0.14 + Math.min(1, spd / 80) * 0.18))
        : 0.0001;
      this.carRumbleGain.gain.setTargetAtTime(rumbleVol, t, 0.03);
    }
  }

  public stopCarAudio() {
    if (!this.carNodesReady || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.carEngineGain?.gain.setTargetAtTime(0.0001, t, 0.04);
    this.carTurboGain?.gain.setTargetAtTime(0.0001, t, 0.04);
    this.carScreechGain?.gain.setTargetAtTime(0.0001, t, 0.04);
    this.carRumbleGain?.gain.setTargetAtTime(0.0001, t, 0.04);
  }

  private playExhaustPop() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.08);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g);
    g.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + 0.10);
  }

  public playConeHit(impactSpeed: number = 12) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const vol = Math.min(0.28, 0.08 + impactSpeed * 0.007);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240 + Math.random() * 80, t);
    osc.frequency.exponentialRampToValueAtTime(75, t + 0.09);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    osc.connect(g);
    g.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  public playCarLand(impactSpeed: number = 6) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const intensity = Math.min(1.0, Math.max(0.25, impactSpeed / 12.0));

    // 1. Deep Heavy Suspension Bottom-Out Thud
    const sub = this.ctx.createOscillator();
    const subG = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(118 + intensity * 35, t);
    sub.frequency.exponentialRampToValueAtTime(26, t + 0.22);
    subG.gain.setValueAtTime(0.45 * intensity, t);
    subG.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    sub.connect(subG);
    subG.connect(this.outputNode);
    sub.start(t);
    sub.stop(t + 0.25);

    // 2. Chassis Frame Compression Punch
    const punch = this.ctx.createOscillator();
    const punchG = this.ctx.createGain();
    punch.type = 'triangle';
    punch.frequency.setValueAtTime(185, t);
    punch.frequency.exponentialRampToValueAtTime(52, t + 0.11);
    punchG.gain.setValueAtTime(0.26 * intensity, t);
    punchG.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    punch.connect(punchG);
    punchG.connect(this.outputNode);
    punch.start(t);
    punch.stop(t + 0.13);

    // 3. Underbody Metal Scrape & Spark Sizzle on Asphalt!
    if (this.sharedNoiseBuffer) {
      const nSrc = this.ctx.createBufferSource();
      nSrc.buffer = this.sharedNoiseBuffer;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.setValueAtTime(2400, t);
      hp.frequency.exponentialRampToValueAtTime(950, t + 0.22);
      hp.Q.setValueAtTime(1.6, t);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.28 * intensity, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.23);
      nSrc.connect(hp);
      hp.connect(ng);
      ng.connect(this.outputNode);
      nSrc.start(t);
      nSrc.stop(t + 0.24);
    }
  }
}
