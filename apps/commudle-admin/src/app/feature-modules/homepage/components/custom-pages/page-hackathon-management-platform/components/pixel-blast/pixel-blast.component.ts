import {
  Component,
  Input,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { EffectComposer, EffectPass, RenderPass, Effect } from 'postprocessing';

type PixelBlastVariant = 'square' | 'circle' | 'triangle' | 'diamond';

interface TouchPoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
  force: number;
  age: number;
}

interface TouchTexture {
  canvas: HTMLCanvasElement;
  texture: THREE.Texture;
  addTouch: (norm: { x: number; y: number }) => void;
  update: () => void;
  radiusScale: number;
  size: number;
}

const SHAPE_MAP: Record<PixelBlastVariant, number> = {
  square: 0,
  circle: 1,
  triangle: 2,
  diamond: 3,
};

const VERTEX_SRC = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SRC = `
precision highp float;

uniform vec3  uColor;
uniform vec2  uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uScale;
uniform float uDensity;
uniform float uPixelJitter;
uniform int   uEnableRipples;
uniform float uRippleSpeed;
uniform float uRippleThickness;
uniform float uRippleIntensity;
uniform float uEdgeFade;

uniform int   uShapeType;
const int SHAPE_SQUARE   = 0;
const int SHAPE_CIRCLE   = 1;
const int SHAPE_TRIANGLE = 2;
const int SHAPE_DIAMOND  = 3;

const int   MAX_CLICKS = 10;

uniform vec2  uClickPos  [MAX_CLICKS];
uniform float uClickTimes[MAX_CLICKS];

out vec4 fragColor;

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2. + a.y * a.y * .75);
}
#define Bayer4(a) (Bayer2(.5*(a))*0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(.5*(a))*0.25 + Bayer2(a))

#define FBM_OCTAVES     5
#define FBM_LACUNARITY  1.25
#define FBM_GAIN        1.0

float hash11(float n){ return fract(sin(n)*43758.5453); }

float vnoise(vec3 p){
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n100 = hash11(dot(ip + vec3(1.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n010 = hash11(dot(ip + vec3(0.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n110 = hash11(dot(ip + vec3(1.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n001 = hash11(dot(ip + vec3(0.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n101 = hash11(dot(ip + vec3(1.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n011 = hash11(dot(ip + vec3(0.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  float n111 = hash11(dot(ip + vec3(1.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  vec3 w = fp*fp*fp*(fp*(fp*6.0-15.0)+10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0  = mix(x00, x10, w.y);
  float y1  = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(vec2 uv, float t){
  vec3 p = vec3(uv * uScale, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < FBM_OCTAVES; ++i){
    sum  += amp * vnoise(p * freq);
    freq *= FBM_LACUNARITY;
    amp  *= FBM_GAIN;
  }
  return sum * 0.5 + 0.5;
}

float maskCircle(vec2 p, float cov){
  float r = sqrt(cov) * .25;
  float d = length(p - 0.5) - r;
  float aa = 0.5 * fwidth(d);
  return cov * (1.0 - smoothstep(-aa, aa, d * 2.0));
}

float maskTriangle(vec2 p, vec2 id, float cov){
  bool flip = mod(id.x + id.y, 2.0) > 0.5;
  if (flip) p.x = 1.0 - p.x;
  float r = sqrt(cov);
  float d  = p.y - r*(1.0 - p.x);
  float aa = fwidth(d);
  return cov * clamp(0.5 - d/aa, 0.0, 1.0);
}

float maskDiamond(vec2 p, float cov){
  float r = sqrt(cov) * 0.564;
  return step(abs(p.x - 0.49) + abs(p.y - 0.49), r);
}

void main(){
  float pixelSize = uPixelSize;
  vec2 fragCoord = gl_FragCoord.xy - uResolution * .5;
  float aspectRatio = uResolution.x / uResolution.y;

  vec2 pixelId = floor(fragCoord / pixelSize);
  vec2 pixelUV = fract(fragCoord / pixelSize);

  float cellPixelSize = 8.0 * pixelSize;
  vec2 cellId = floor(fragCoord / cellPixelSize);
  vec2 cellCoord = cellId * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

  float base = fbm2(uv, uTime * 0.05);
  base = base * 0.5 - 0.65;

  float feed = base + (uDensity - 0.5) * 0.3;

  float speed     = uRippleSpeed;
  float thickness = uRippleThickness;
  const float dampT     = 1.0;
  const float dampR     = 10.0;

  if (uEnableRipples == 1) {
    for (int i = 0; i < MAX_CLICKS; ++i){
      vec2 pos = uClickPos[i];
      if (pos.x < 0.0) continue;
      float cellPixelSize = 8.0 * pixelSize;
      vec2 cuv = (((pos - uResolution * .5 - cellPixelSize * .5) / (uResolution))) * vec2(aspectRatio, 1.0);
      float t = max(uTime - uClickTimes[i], 0.0);
      float r = distance(uv, cuv);
      float waveR = speed * t;
      float ring  = exp(-pow((r - waveR) / thickness, 2.0));
      float atten = exp(-dampT * t) * exp(-dampR * r);
      feed = max(feed, ring * atten * uRippleIntensity);
    }
  }

  float bayer = Bayer8(fragCoord / uPixelSize) - 0.5;
  float bw = step(0.5, feed + bayer);

  float h = fract(sin(dot(floor(fragCoord / uPixelSize), vec2(127.1, 311.7))) * 43758.5453);
  float jitterScale = 1.0 + (h - 0.5) * uPixelJitter;
  float coverage = bw * jitterScale;
  float M;
  if      (uShapeType == SHAPE_CIRCLE)   M = maskCircle (pixelUV, coverage);
  else if (uShapeType == SHAPE_TRIANGLE) M = maskTriangle(pixelUV, pixelId, coverage);
  else if (uShapeType == SHAPE_DIAMOND)  M = maskDiamond(pixelUV, coverage);
  else                                   M = coverage;

  if (uEdgeFade > 0.0) {
    vec2 norm = gl_FragCoord.xy / uResolution;
    float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
    float fade = smoothstep(0.0, uEdgeFade, edge);
    M *= fade;
  }

  vec3 color = uColor;

  vec3 srgbColor = mix(
    color * 12.92,
    1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
    step(0.0031308, color)
  );

  fragColor = vec4(srgbColor, M);
}
`;

const MAX_CLICKS = 10;

const createTouchTexture = (): TouchTexture => {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context not available');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.Texture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const trail: TouchPoint[] = [];
  let last: { x: number; y: number } | null = null;
  const maxAge = 64;
  let radius = 0.1 * size;
  const speed = 1 / maxAge;

  const clear = () => {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const drawPoint = (p: TouchPoint) => {
    const pos = { x: p.x * size, y: (1 - p.y) * size };
    let intensity = 1;
    const easeOutSine = (t: number) => Math.sin((t * Math.PI) / 2);
    const easeOutQuad = (t: number) => -t * (t - 2);
    if (p.age < maxAge * 0.3) intensity = easeOutSine(p.age / (maxAge * 0.3));
    else intensity = easeOutQuad(1 - (p.age - maxAge * 0.3) / (maxAge * 0.7)) || 0;
    intensity *= p.force;
    const color = `${((p.vx + 1) / 2) * 255}, ${((p.vy + 1) / 2) * 255}, ${intensity * 255}`;
    const offset = size * 5;
    ctx.shadowOffsetX = offset;
    ctx.shadowOffsetY = offset;
    ctx.shadowBlur = radius;
    ctx.shadowColor = `rgba(${color},${0.22 * intensity})`;
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,0,0,1)';
    ctx.arc(pos.x - offset, pos.y - offset, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  const addTouch = (norm: { x: number; y: number }) => {
    let force = 0;
    let vx = 0;
    let vy = 0;
    if (last) {
      const dx = norm.x - last.x;
      const dy = norm.y - last.y;
      if (dx === 0 && dy === 0) return;
      const dd = dx * dx + dy * dy;
      const d = Math.sqrt(dd);
      vx = dx / (d || 1);
      vy = dy / (d || 1);
      force = Math.min(dd * 10000, 1);
    }
    last = { x: norm.x, y: norm.y };
    trail.push({ x: norm.x, y: norm.y, age: 0, force, vx, vy });
  };

  const update = () => {
    clear();
    for (let i = trail.length - 1; i >= 0; i--) {
      const point = trail[i];
      const f = point.force * speed * (1 - point.age / maxAge);
      point.x += point.vx * f;
      point.y += point.vy * f;
      point.age++;
      if (point.age > maxAge) trail.splice(i, 1);
    }
    for (let i = 0; i < trail.length; i++) drawPoint(trail[i]);
    texture.needsUpdate = true;
  };

  return {
    canvas,
    texture,
    addTouch,
    update,
    set radiusScale(v: number) {
      radius = 0.1 * size * v;
    },
    get radiusScale() {
      return radius / (0.1 * size);
    },
    size,
  };
};

const createLiquidEffect = (texture: THREE.Texture, opts?: { strength?: number; freq?: number }) => {
  const fragment = `
    uniform sampler2D uTexture;
    uniform float uStrength;
    uniform float uTime;
    uniform float uFreq;

    void mainUv(inout vec2 uv) {
      vec4 tex = texture2D(uTexture, uv);
      float vx = tex.r * 2.0 - 1.0;
      float vy = tex.g * 2.0 - 1.0;
      float intensity = tex.b;

      float wave = 0.5 + 0.5 * sin(uTime * uFreq + intensity * 6.2831853);

      float amt = uStrength * intensity * wave;

      uv += vec2(vx, vy) * amt;
    }
  `;
  return new Effect('LiquidEffect', fragment, {
    uniforms: new Map<string, THREE.Uniform>([
      ['uTexture', new THREE.Uniform(texture)],
      ['uStrength', new THREE.Uniform(opts?.strength ?? 0.025)],
      ['uTime', new THREE.Uniform(0)],
      ['uFreq', new THREE.Uniform(opts?.freq ?? 4.5)],
    ]),
  });
};

@Component({
  selector: 'commudle-pixel-blast',
  standalone: true,
  imports: [CommonModule],
  template: ` <div #container class="pixel-blast-container" aria-label="PixelBlast interactive background"></div> `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .pixel-blast-container {
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
      }
    `,
  ],
})
export class PixelBlastComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('container') containerRef!: ElementRef<HTMLDivElement>;

  @Input() variant: PixelBlastVariant = 'square';
  @Input() pixelSize = 3;
  @Input() color = '#B19EEF';
  @Input() antialias = true;
  @Input() patternScale = 2;
  @Input() patternDensity = 1;
  @Input() liquid = false;
  @Input() liquidStrength = 0.1;
  @Input() liquidRadius = 1;
  @Input() pixelSizeJitter = 0;
  @Input() enableRipples = true;
  @Input() rippleIntensityScale = 1;
  @Input() rippleThickness = 0.1;
  @Input() rippleSpeed = 0.3;
  @Input() liquidWobbleSpeed = 4.5;
  @Input() autoPauseOffscreen = true;
  @Input() speed = 0.5;
  @Input() transparent = true;
  @Input() edgeFade = 0.5;
  @Input() noiseAmount = 0;

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.OrthographicCamera;
  private material?: THREE.ShaderMaterial;
  private clock?: THREE.Clock;
  private clickIx = 0;
  private uniforms?: any;
  private resizeObserver?: ResizeObserver;
  private raf?: number;
  private quad?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private timeOffset = 0;
  private composer?: EffectComposer;
  private touch?: TouchTexture;
  private liquidEffect?: Effect;
  private speedRef = 0.5;
  private visible = true;

  constructor(private ngZone: NgZone) {}

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.initThree();
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!this.uniforms) return;

    if (changes['variant']) {
      this.uniforms.uShapeType.value = SHAPE_MAP[this.variant] ?? 0;
    }
    if (changes['pixelSize'] && this.renderer) {
      this.uniforms.uPixelSize.value = this.pixelSize * this.renderer.getPixelRatio();
    }
    if (changes['color']) {
      this.uniforms.uColor.value.set(this.color);
    }
    if (changes['patternScale']) {
      this.uniforms.uScale.value = this.patternScale;
    }
    if (changes['patternDensity']) {
      this.uniforms.uDensity.value = this.patternDensity;
    }
    if (changes['pixelSizeJitter']) {
      this.uniforms.uPixelJitter.value = this.pixelSizeJitter;
    }
    if (changes['enableRipples']) {
      this.uniforms.uEnableRipples.value = this.enableRipples ? 1 : 0;
    }
    if (changes['rippleIntensityScale']) {
      this.uniforms.uRippleIntensity.value = this.rippleIntensityScale;
    }
    if (changes['rippleThickness']) {
      this.uniforms.uRippleThickness.value = this.rippleThickness;
    }
    if (changes['rippleSpeed']) {
      this.uniforms.uRippleSpeed.value = this.rippleSpeed;
    }
    if (changes['edgeFade']) {
      this.uniforms.uEdgeFade.value = this.edgeFade;
    }
    if (changes['speed']) {
      this.speedRef = this.speed;
    }
  }

  private initThree() {
    const container = this.containerRef.nativeElement;
    if (!container) return;

    this.speedRef = this.speed;

    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.antialias,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);

    if (this.transparent) {
      this.renderer.setClearAlpha(0);
    } else {
      this.renderer.setClearColor(0x000000, 1);
    }

    this.uniforms = {
      uResolution: { value: new THREE.Vector2(0, 0) },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(this.color) },
      uClickPos: {
        value: Array.from({ length: MAX_CLICKS }, () => new THREE.Vector2(-1, -1)),
      },
      uClickTimes: { value: new Float32Array(MAX_CLICKS) },
      uShapeType: { value: SHAPE_MAP[this.variant] ?? 0 },
      uPixelSize: { value: this.pixelSize * this.renderer.getPixelRatio() },
      uScale: { value: this.patternScale },
      uDensity: { value: this.patternDensity },
      uPixelJitter: { value: this.pixelSizeJitter },
      uEnableRipples: { value: this.enableRipples ? 1 : 0 },
      uRippleSpeed: { value: this.rippleSpeed },
      uRippleThickness: { value: this.rippleThickness },
      uRippleIntensity: { value: this.rippleIntensityScale },
      uEdgeFade: { value: this.edgeFade },
    };

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SRC,
      fragmentShader: FRAGMENT_SRC,
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
    });

    const quadGeom = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(quadGeom, this.material);
    this.scene.add(this.quad);

    this.clock = new THREE.Clock();

    const setSize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      this.renderer!.setSize(w, h, false);
      this.uniforms.uResolution.value.set(this.renderer!.domElement.width, this.renderer!.domElement.height);
      if (this.composer) {
        this.composer.setSize(this.renderer!.domElement.width, this.renderer!.domElement.height);
      }
      this.uniforms.uPixelSize.value = this.pixelSize * this.renderer!.getPixelRatio();
    };

    setSize();
    this.resizeObserver = new ResizeObserver(setSize);
    this.resizeObserver.observe(container);

    const randomFloat = (): number => {
      if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
        const u32 = new Uint32Array(1);
        window.crypto.getRandomValues(u32);
        return u32[0] / 0xffffffff;
      }
      return Math.random();
    };

    this.timeOffset = randomFloat() * 1000;

    if (this.liquid) {
      this.touch = createTouchTexture();
      this.touch.radiusScale = this.liquidRadius;
      this.composer = new EffectComposer(this.renderer);
      const renderPass = new RenderPass(this.scene, this.camera);
      this.liquidEffect = createLiquidEffect(this.touch.texture, {
        strength: this.liquidStrength,
        freq: this.liquidWobbleSpeed,
      });
      const effectPass = new EffectPass(this.camera, this.liquidEffect);
      (effectPass as any).renderToScreen = true;
      this.composer.addPass(renderPass);
      this.composer.addPass(effectPass);
    }

    if (this.composer) {
      this.composer.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
    }

    const mapToPixels = (e: PointerEvent) => {
      const rect = this.renderer!.domElement.getBoundingClientRect();
      const scaleX = this.renderer!.domElement.width / rect.width;
      const scaleY = this.renderer!.domElement.height / rect.height;
      const fx = (e.clientX - rect.left) * scaleX;
      const fy = (rect.height - (e.clientY - rect.top)) * scaleY;
      return {
        fx,
        fy,
        w: this.renderer!.domElement.width,
        h: this.renderer!.domElement.height,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      const { fx, fy } = mapToPixels(e);
      this.uniforms.uClickPos.value[this.clickIx].set(fx, fy);
      this.uniforms.uClickTimes.value[this.clickIx] = this.uniforms.uTime.value;
      this.clickIx = (this.clickIx + 1) % MAX_CLICKS;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.touch) return;
      const { fx, fy, w, h } = mapToPixels(e);
      this.touch.addTouch({ x: fx / w, y: fy / h });
    };

    this.renderer.domElement.addEventListener('pointerdown', onPointerDown, {
      passive: true,
    });
    this.renderer.domElement.addEventListener('pointermove', onPointerMove, {
      passive: true,
    });

    const animate = () => {
      if (this.autoPauseOffscreen && !this.visible) {
        this.raf = requestAnimationFrame(animate);
        return;
      }

      this.uniforms.uTime.value = this.timeOffset + this.clock!.getElapsedTime() * this.speedRef;

      if (this.liquidEffect) {
        const liqEffect = this.liquidEffect as Effect & {
          uniforms: Map<string, THREE.Uniform>;
        };
        const timeUniform = liqEffect.uniforms.get('uTime');
        if (timeUniform) timeUniform.value = this.uniforms.uTime.value;
      }

      if (this.composer) {
        if (this.touch) this.touch.update();
        this.composer.render();
      } else {
        this.renderer!.render(this.scene!, this.camera!);
      }

      this.raf = requestAnimationFrame(animate);
    };

    this.raf = requestAnimationFrame(animate);
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    if (this.raf) {
      cancelAnimationFrame(this.raf);
    }
    this.quad?.geometry.dispose();
    this.material?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement.parentElement === this.containerRef?.nativeElement) {
      this.containerRef.nativeElement.removeChild(this.renderer.domElement);
    }
  }
}
