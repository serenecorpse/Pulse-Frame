import * as THREE from "three";
import { PitchDetector } from "pitchy";
import "./style.css";

type PresetName = "edm" | "vocal" | "acoustic" | "indian" | "balanced";

interface FirePreset {
  baseHeight: number;
  baseWidth: number;
  lowMultiplier: number;
  midMultiplier: number;
  highMultiplier: number;
  flicker: number;
  explosionThreshold: number;
  explosionMultiplier: number;
}

interface PitchResult {
  frequency: number | null;
  normalized: number;
  clarity: number;
}

interface FireParticle {
  active: boolean;
  life: number;
  maxLife: number;
  velocity: THREE.Vector3;
}

const PRESETS: Record<PresetName, FirePreset> = {
  edm: {
    baseHeight: 2.6,
    baseWidth: 2.7,
    lowMultiplier: 2.25,
    midMultiplier: 0.8,
    highMultiplier: 0.7,
    flicker: 1.0,
    explosionThreshold: 0.07,
    explosionMultiplier: 1.9,
  },

  vocal: {
    baseHeight: 3.3,
    baseWidth: 1.25,
    lowMultiplier: 0.75,
    midMultiplier: 1.85,
    highMultiplier: 1.3,
    flicker: 2.15,
    explosionThreshold: 0.13,
    explosionMultiplier: 0.8,
  },

  acoustic: {
    baseHeight: 2.2,
    baseWidth: 1.45,
    lowMultiplier: 1.0,
    midMultiplier: 1.45,
    highMultiplier: 1.15,
    flicker: 1.45,
    explosionThreshold: 0.12,
    explosionMultiplier: 0.9,
  },

  indian: {
    baseHeight: 3.25,
    baseWidth: 1.18,
    lowMultiplier: 0.9,
    midMultiplier: 1.55,
    highMultiplier: 1.8,
    flicker: 2.35,
    explosionThreshold: 0.11,
    explosionMultiplier: 1.05,
  },

  balanced: {
    baseHeight: 2.55,
    baseWidth: 1.8,
    lowMultiplier: 1.2,
    midMultiplier: 1.2,
    highMultiplier: 1.2,
    flicker: 1.3,
    explosionThreshold: 0.11,
    explosionMultiplier: 1.0,
  },
};

// -----------------------------------------------------------------------------
// DOM
// -----------------------------------------------------------------------------

const container = document.querySelector<HTMLDivElement>(
  "#visualizerContainer",
);
const fireCanvas = document.querySelector<HTMLCanvasElement>("#fireCanvas");
const bloomCanvas = document.querySelector<HTMLCanvasElement>("#bloomCanvas");
const audioPlayer = document.querySelector<HTMLAudioElement>("#audioPlayer");

const micButton = document.querySelector<HTMLButtonElement>("#micButton");
const audioFileInput = document.querySelector<HTMLInputElement>("#audioFile");
const presetSelect = document.querySelector<HTMLSelectElement>("#presetSelect");

const fireIntensityInput =
  document.querySelector<HTMLInputElement>("#fireIntensity");
const bloomStrengthInput =
  document.querySelector<HTMLInputElement>("#bloomStrength");
const sensitivityInput =
  document.querySelector<HTMLInputElement>("#sensitivity");

const fireIntensityValue = document.querySelector<HTMLSpanElement>(
  "#fireIntensityValue",
);
const bloomStrengthValue = document.querySelector<HTMLSpanElement>(
  "#bloomStrengthValue",
);
const sensitivityValue =
  document.querySelector<HTMLSpanElement>("#sensitivityValue");

const pitchInfo = document.querySelector<HTMLDivElement>("#pitchInfo");
const energyInfo = document.querySelector<HTMLDivElement>("#energyInfo");
const status = document.querySelector<HTMLParagraphElement>("#status");

if (
  !container ||
  !fireCanvas ||
  !bloomCanvas ||
  !audioPlayer ||
  !micButton ||
  !audioFileInput ||
  !presetSelect ||
  !fireIntensityInput ||
  !bloomStrengthInput ||
  !sensitivityInput ||
  !fireIntensityValue ||
  !bloomStrengthValue ||
  !sensitivityValue ||
  !pitchInfo ||
  !energyInfo ||
  !status
) {
  throw new Error("One or more required HTML elements are missing.");
}

// -----------------------------------------------------------------------------
// Application settings
// -----------------------------------------------------------------------------

let selectedPreset: PresetName = "balanced";
let fireIntensity = 1.2;
let bloomStrength = 1.4;
let sensitivity = 1.0;

let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let activeSource: AudioNode | null = null;
let activeStream: MediaStream | null = null;
let mediaElementSource: MediaElementAudioSourceNode | null = null;

let frequencyData: Uint8Array | null = null;
let timeDomainData: Float32Array | null = null;
let pitchDetector: PitchDetector<Float32Array> | null = null;

// -----------------------------------------------------------------------------
// Audio setup
// -----------------------------------------------------------------------------

function initializeAudio(): void {
  if (audioContext && analyser) {
    return;
  }

  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();

  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.72;

  frequencyData = new Uint8Array(analyser.frequencyBinCount);
  timeDomainData = new Float32Array(analyser.fftSize);
  pitchDetector = PitchDetector.forFloat32Array(analyser.fftSize);
}

async function resumeAudioContext(): Promise<void> {
  initializeAudio();

  if (audioContext?.state === "suspended") {
    await audioContext.resume();
  }
}

function stopCurrentInput(): void {
  if (activeSource && activeSource !== mediaElementSource) {
    activeSource.disconnect();
  }

  activeSource = null;

  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }

  audioPlayer.pause();
}

function updateStatus(message: string): void {
  status.innerHTML = `<strong>Status:</strong> ${message}`;
}

micButton.addEventListener("click", async () => {
  try {
    await resumeAudioContext();
    stopCurrentInput();

    if (!audioContext || !analyser) {
      return;
    }

    activeStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    activeSource = audioContext.createMediaStreamSource(activeStream);
    activeSource.connect(analyser);

    updateStatus("🎤 Listening through your microphone.");
  } catch (error) {
    console.error(error);
    updateStatus("❌ Microphone permission was denied or unavailable.");
  }
});

audioFileInput.addEventListener("change", async () => {
  const file = audioFileInput.files?.[0];

  if (!file) {
    return;
  }

  try {
    await resumeAudioContext();
    stopCurrentInput();

    if (!audioContext || !analyser) {
      return;
    }

    audioPlayer.src = URL.createObjectURL(file);
    audioPlayer.style.display = "block";

    // A MediaElementAudioSourceNode may only be created once for an audio element.
    if (!mediaElementSource) {
      mediaElementSource = audioContext.createMediaElementSource(audioPlayer);
      mediaElementSource.connect(analyser);
      analyser.connect(audioContext.destination);
    }

    activeSource = mediaElementSource;

    await audioPlayer.play();

    updateStatus(`▶ Playing <em>${file.name}</em>`);
  } catch (error) {
    console.error(error);
    updateStatus("❌ Could not play the selected audio file.");
  }
});

// -----------------------------------------------------------------------------
// Three.js scene
// -----------------------------------------------------------------------------

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x060407, 0.07);

const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
camera.position.set(0, 0.1, 10);

const renderer = new THREE.WebGLRenderer({
  canvas: fireCanvas,
  antialias: true,
  alpha: true,

  // Required so the canvas can be copied into the bloom canvas.
  preserveDrawingBuffer: true,
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);

const fireGroup = new THREE.Group();
scene.add(fireGroup);

const warmLight = new THREE.PointLight(0xff5800, 5, 20);
warmLight.position.set(0, -0.3, 3);
scene.add(warmLight);

const ambientLight = new THREE.AmbientLight(0xffa05a, 0.33);
scene.add(ambientLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(8, 64),
  new THREE.MeshBasicMaterial({
    color: 0x100603,
    transparent: true,
    opacity: 0.5,
  }),
);

floor.rotation.x = -Math.PI / 2;
floor.position.y = -2.65;
floor.position.z = -1.2;
scene.add(floor);

// -----------------------------------------------------------------------------
// Shader-based 3D-style fire
// -----------------------------------------------------------------------------

const fireVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;

    gl_Position =
      projectionMatrix *
      modelViewMatrix *
      vec4(position, 1.0);
  }
`;

const fireFragmentShader = `
  varying vec2 vUv;

  uniform float uTime;
  uniform float uEnergy;
  uniform float uLow;
  uniform float uMid;
  uniform float uHigh;
  uniform float uPitch;
  uniform float uBaseHeight;
  uniform float uBaseWidth;
  uniform float uFlicker;
  uniform float uExplosion;
  uniform float uIntensity;

  float random(vec2 point) {
    return fract(
      sin(dot(point, vec2(12.9898, 78.233))) * 43758.5453
    );
  }

  float noise(vec2 point) {
    vec2 integer = floor(point);
    vec2 decimal = fract(point);

    float a = random(integer);
    float b = random(integer + vec2(1.0, 0.0));
    float c = random(integer + vec2(0.0, 1.0));
    float d = random(integer + vec2(1.0, 1.0));

    vec2 smoothDecimal = decimal * decimal * (3.0 - 2.0 * decimal);

    return mix(
      mix(a, b, smoothDecimal.x),
      mix(c, d, smoothDecimal.x),
      smoothDecimal.y
    );
  }

  float fbm(vec2 point) {
    float result = 0.0;
    float amplitude = 0.5;

    for (int index = 0; index < 5; index++) {
      result += amplitude * noise(point);
      point *= 2.02;
      amplitude *= 0.5;
    }

    return result;
  }

  void main() {
    vec2 uv = vUv;

    float movingNoise = fbm(
      vec2(
        uv.x * 3.2 + sin(uTime * 0.4) * 0.3,
        uv.y * 3.8 - uTime * (0.72 + uFlicker * 0.12)
      )
    );

    // Bass expands the lower/base area of the flame.
    float flameWidth =
      0.13 +
      uLow * 0.24 * uBaseWidth +
      uExplosion * 0.18;

    // Vocal/mid frequencies make the flame taller.
    float flameHeight =
      0.24 +
      uEnergy * 0.22 +
      uMid * 0.20 * uBaseHeight +
      uHigh * 0.08 +
      uExplosion * 0.22;

    float distanceFromCenter = abs(uv.x - 0.5);

    float sideDistortion =
      (movingNoise - 0.5) *
      (0.16 + uHigh * 0.18) *
      (1.0 - uv.y);

    float shapeWidth =
      flameWidth *
      (1.0 - uv.y) *
      (1.0 + movingNoise * 0.85);

    // The flame is visible inside its shaped boundary.
    float flameMask =
      1.0 - smoothstep(
        shapeWidth - 0.05,
        shapeWidth + 0.025,
        distanceFromCenter + sideDistortion
      );

    float topFade =
      1.0 - smoothstep(
        flameHeight,
        flameHeight + 0.22,
        uv.y
      );

    float flame = flameMask * topFade;

    // Pitch-based colors.
    vec3 lowColor = vec3(1.0, 0.05, 0.0); // red
    vec3 midColor = vec3(1.0, 0.56, 0.01); // orange/gold
    vec3 highColor = vec3(0.22, 0.70, 1.0); // blue
    vec3 whiteHot = vec3(0.95, 0.98, 1.0); // white/cyan

    vec3 pitchColor;

    if (uPitch < 0.5) {
      pitchColor = mix(lowColor, midColor, uPitch * 2.0);
    } else {
      pitchColor = mix(midColor, highColor, (uPitch - 0.5) * 2.0);
    }

    float core =
      1.0 - smoothstep(
        0.0,
        max(flameWidth * 0.7, 0.01),
        distanceFromCenter
      );

    vec3 finalColor = mix(
      pitchColor,
      whiteHot,
      core * (0.25 + uHigh * 0.35)
    );

    float flicker =
      0.80 +
      sin(uTime * 8.0 + uv.y * 8.0) * 0.10 * uFlicker +
      movingNoise * 0.22;

    float alpha =
      flame *
      flicker *
      (0.40 + uEnergy * 1.15) *
      uIntensity;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

function createFireMaterial(): THREE.ShaderMaterial {
  const preset = PRESETS[selectedPreset];

  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,

    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uLow: { value: 0 },
      uMid: { value: 0 },
      uHigh: { value: 0 },
      uPitch: { value: 0.35 },
      uBaseHeight: { value: preset.baseHeight },
      uBaseWidth: { value: preset.baseWidth },
      uFlicker: { value: preset.flicker },
      uExplosion: { value: 0 },
      uIntensity: { value: fireIntensity },
    },

    vertexShader: fireVertexShader,
    fragmentShader: fireFragmentShader,
  });
}

const flameGeometry = new THREE.PlaneGeometry(5.6, 7.8);

// Crossed planes provide depth from multiple viewing angles.
[0, Math.PI / 3, (Math.PI * 2) / 3].forEach((rotation, index) => {
  const flame = new THREE.Mesh(flameGeometry, createFireMaterial());

  flame.rotation.y = rotation;
  flame.position.y = -1.1;
  flame.position.x = (index - 1) * 0.08;
  flame.position.z = -0.4;

  fireGroup.add(flame);
});

// -----------------------------------------------------------------------------
// Explosion particle system
// -----------------------------------------------------------------------------

const MAX_PARTICLES = 500;

const particlePositions = new Float32Array(MAX_PARTICLES * 3);
const particleColors = new Float32Array(MAX_PARTICLES * 3);

const particles: FireParticle[] = Array.from({ length: MAX_PARTICLES }, () => ({
  active: false,
  life: 0,
  maxLife: 1,
  velocity: new THREE.Vector3(),
}));

const particleGeometry = new THREE.BufferGeometry();

particleGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(particlePositions, 3),
);

particleGeometry.setAttribute(
  "color",
  new THREE.BufferAttribute(particleColors, 3),
);

const particleMaterial = new THREE.PointsMaterial({
  size: 0.13,
  transparent: true,
  opacity: 0.9,
  vertexColors: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particleSystem);

function getFireColorFromPitch(normalizedPitch: number): THREE.Color {
  const color = new THREE.Color();

  // Hue values:
  // 0.02 = red
  // 0.08 = orange
  // 0.58 = blue
  const hue = THREE.MathUtils.lerp(0.02, 0.58, normalizedPitch);

  color.setHSL(hue, 1, THREE.MathUtils.lerp(0.52, 0.78, normalizedPitch));

  return color;
}

function spawnExplosion(power: number, normalizedPitch: number): void {
  const particleCount = Math.min(MAX_PARTICLES, Math.floor(60 + power * 190));

  const color = getFireColorFromPitch(normalizedPitch);
  let created = 0;

  for (let index = 0; index < MAX_PARTICLES; index++) {
    if (created >= particleCount) {
      break;
    }

    const particle = particles[index];

    if (particle.active) {
      continue;
    }

    particle.active = true;
    particle.life = 0.45 + Math.random() * 0.9;
    particle.maxLife = particle.life;

    particlePositions[index * 3] = (Math.random() - 0.5) * 0.8;
    particlePositions[index * 3 + 1] = -1.4 + Math.random() * 0.5;
    particlePositions[index * 3 + 2] = (Math.random() - 0.5) * 0.8;

    particle.velocity.set(
      (Math.random() - 0.5) * power * 4.4,
      1.4 + Math.random() * power * 5.5,
      (Math.random() - 0.5) * power * 3.2,
    );

    particleColors[index * 3] = color.r;
    particleColors[index * 3 + 1] = color.g;
    particleColors[index * 3 + 2] = color.b;

    created++;
  }
}

function updateParticles(deltaTime: number): void {
  particles.forEach((particle, index) => {
    if (!particle.active) {
      particlePositions[index * 3 + 1] = -100;
      return;
    }

    particle.life -= deltaTime;

    if (particle.life <= 0) {
      particle.active = false;
      particlePositions[index * 3 + 1] = -100;
      return;
    }

    particlePositions[index * 3] += particle.velocity.x * deltaTime;
    particlePositions[index * 3 + 1] += particle.velocity.y * deltaTime;
    particlePositions[index * 3 + 2] += particle.velocity.z * deltaTime;

    particle.velocity.y -= 1.5 * deltaTime;
    particle.velocity.x *= 0.985;
    particle.velocity.z *= 0.985;
  });

  particleGeometry.attributes.position.needsUpdate = true;
}

// -----------------------------------------------------------------------------
// Audio analysis
// -----------------------------------------------------------------------------

function getBandEnergy(minFrequency: number, maxFrequency: number): number {
  if (!audioContext || !frequencyData) {
    return 0;
  }

  const nyquist = audioContext.sampleRate / 2;

  const startIndex = Math.max(
    0,
    Math.floor((minFrequency / nyquist) * frequencyData.length),
  );

  const endIndex = Math.min(
    frequencyData.length - 1,
    Math.ceil((maxFrequency / nyquist) * frequencyData.length),
  );

  let total = 0;
  let count = 0;

  for (let index = startIndex; index <= endIndex; index++) {
    total += frequencyData[index];
    count++;
  }

  return count > 0 ? total / count / 255 : 0;
}

function detectPitch(): PitchResult {
  if (!audioContext || !analyser || !timeDomainData || !pitchDetector) {
    return {
      frequency: null,
      normalized: 0.35,
      clarity: 0,
    };
  }

  analyser.getFloatTimeDomainData(timeDomainData);

  const [frequency, clarity] = pitchDetector.findPitch(
    timeDomainData,
    audioContext.sampleRate,
  );

  if (clarity < 0.82 || frequency < 55 || frequency > 1800) {
    return {
      frequency: null,
      normalized: 0.35,
      clarity,
    };
  }

  // Logarithmic mapping matches human musical pitch perception.
  const normalized = THREE.MathUtils.clamp(
    Math.log2(frequency / 70) / Math.log2(1400 / 70),
    0,
    1,
  );

  return {
    frequency,
    normalized,
    clarity,
  };
}

function getNoteName(frequency: number): string {
  const noteNames = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B",
  ];

  const midiNumber = Math.round(12 * Math.log2(frequency / 440) + 69);
  const note = noteNames[midiNumber % 12];
  const octave = Math.floor(midiNumber / 12) - 1;

  return `${note}${octave}`;
}

// -----------------------------------------------------------------------------
// Bloom canvas overlay
// -----------------------------------------------------------------------------

const bloomContext = bloomCanvas.getContext("2d");

if (!bloomContext) {
  throw new Error("Could not create bloom canvas context.");
}

function renderBloom(): void {
  bloomContext.clearRect(0, 0, bloomCanvas.width, bloomCanvas.height);

  const blurPixels = 4 + bloomStrength * 14;

  bloomContext.save();
  bloomContext.filter = `blur(${blurPixels}px)`;
  bloomContext.globalAlpha = 0.35 + bloomStrength * 0.2;

  bloomContext.drawImage(
    fireCanvas,
    0,
    0,
    bloomCanvas.width,
    bloomCanvas.height,
  );

  bloomContext.restore();
}

// -----------------------------------------------------------------------------
// Resize
// -----------------------------------------------------------------------------

function resizeRenderer(): void {
  const width = container.clientWidth;
  const height = container.clientHeight;
  const pixelRatio = Math.min(window.devicePixelRatio, 2);

  renderer.setSize(width, height, false);

  bloomCanvas.width = Math.floor(width * pixelRatio);
  bloomCanvas.height = Math.floor(height * pixelRatio);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resizeRenderer);
resizeRenderer();

// -----------------------------------------------------------------------------
// Controls
// -----------------------------------------------------------------------------

function updatePreset(): void {
  const preset = PRESETS[selectedPreset];

  fireGroup.children.forEach((object) => {
    const mesh = object as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.ShaderMaterial
    >;

    mesh.material.uniforms.uBaseHeight.value = preset.baseHeight;
    mesh.material.uniforms.uBaseWidth.value = preset.baseWidth;
    mesh.material.uniforms.uFlicker.value = preset.flicker;
  });
}

presetSelect.addEventListener("change", () => {
  selectedPreset = presetSelect.value as PresetName;
  updatePreset();

  updateStatus(
    `🎺 Preset changed to <em>${presetSelect.selectedOptions[0].text}</em>.`,
  );
});

fireIntensityInput.addEventListener("input", () => {
  fireIntensity = Number(fireIntensityInput.value);
  fireIntensityValue.textContent = fireIntensity.toFixed(1);
});

bloomStrengthInput.addEventListener("input", () => {
  bloomStrength = Number(bloomStrengthInput.value);
  bloomStrengthValue.textContent = bloomStrength.toFixed(1);
});

sensitivityInput.addEventListener("input", () => {
  sensitivity = Number(sensitivityInput.value);
  sensitivityValue.textContent = sensitivity.toFixed(1);
});

// -----------------------------------------------------------------------------
// Animation loop
// -----------------------------------------------------------------------------

const clock = new THREE.Clock();

let elapsedTime = 0;
let previousEnergy = 0;
let currentExplosion = 0;

function animate(): void {
  requestAnimationFrame(animate);

  const deltaTime = Math.min(clock.getDelta(), 0.05);
  elapsedTime += deltaTime;

  if (analyser && frequencyData) {
    analyser.getByteFrequencyData(frequencyData);
  }

  const preset = PRESETS[selectedPreset];

  const low = getBandEnergy(20, 180) * preset.lowMultiplier * sensitivity;
  const mid = getBandEnergy(180, 2200) * preset.midMultiplier * sensitivity;
  const high = getBandEnergy(2200, 8500) * preset.highMultiplier * sensitivity;

  const energy = THREE.MathUtils.clamp(
    low * 0.5 + mid * 0.35 + high * 0.15,
    0,
    1.5,
  );

  const pitch = detectPitch();
  const energyRise = energy - previousEnergy;

  // A sudden loud energy jump triggers an explosion.
  if (energy > 0.25 && energyRise > preset.explosionThreshold) {
    const explosionPower = Math.min(
      1.5,
      energyRise * 9 * preset.explosionMultiplier,
    );

    currentExplosion = Math.max(currentExplosion, explosionPower);
    spawnExplosion(explosionPower, pitch.normalized);
  }

  previousEnergy += (energy - previousEnergy) * 0.11;
  currentExplosion *= 0.91;

  fireGroup.children.forEach((object) => {
    const mesh = object as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.ShaderMaterial
    >;

    const uniforms = mesh.material.uniforms;

    uniforms.uTime.value = elapsedTime;
    uniforms.uEnergy.value = energy;
    uniforms.uLow.value = low;
    uniforms.uMid.value = mid;
    uniforms.uHigh.value = high;
    uniforms.uPitch.value = pitch.normalized;
    uniforms.uExplosion.value = currentExplosion;
    uniforms.uIntensity.value = fireIntensity;
  });

  warmLight.intensity = 1.0 + energy * 7 + currentExplosion * 4;
  fireGroup.rotation.y = Math.sin(elapsedTime * 0.25) * 0.18;

  updateParticles(deltaTime);

  renderer.render(scene, camera);
  renderBloom();

  energyInfo.textContent = `Energy: ${Math.round(
    Math.min(100, energy * 100),
  )}%`;

  if (pitch.frequency) {
    pitchInfo.textContent = `Pitch: ${getNoteName(
      pitch.frequency,
    )} · ${Math.round(pitch.frequency)} Hz`;
  } else {
    pitchInfo.textContent = "Pitch: listening…";
  }
}

animate();
