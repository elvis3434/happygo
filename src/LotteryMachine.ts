import Matter from 'matter-js';

type GameMode = '539' | 'lotto' | 'super';
type GameState = 'idle' | 'filling' | 'mixing' | 'drawing' | 'done' | 'round2-ready' | 'round2-mixing' | 'round2-drawing' | 'round2-done';

interface ModeConfig {
  totalBalls: number;
  drawCount: number;
  label: string;
}

interface Round2Config {
  totalBalls: number;
  drawCount: number;
}

interface EjectingBall {
  number: number;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  scale: number;
  opacity: number;
  trail: { x: number; y: number; opacity: number }[];
  phase: 'attracting' | 'struggling' | 'rising' | 'done';
  targetX: number;
  targetY: number;
  struggleFrames: number;
  isSpecial: boolean;
}

const MODE_CONFIGS: Record<GameMode, ModeConfig> = {
  '539':  { totalBalls: 39, drawCount: 5, label: '今彩539' },
  'lotto': { totalBalls: 49, drawCount: 6, label: '大樂透' },
  'super': { totalBalls: 38, drawCount: 6, label: '威力彩' },
};

const SUPER_ROUND2: Round2Config = { totalBalls: 8, drawCount: 1 };

const CONTAINER_RADIUS = 220;
const BALL_RADIUS = 16;
const CANVAS_SIZE = CONTAINER_RADIUS * 2 + 40;
const CENTER = CANVAS_SIZE / 2;
const WALL_SEGMENTS = 64;
const EJECTION_GAP_ANGLE = -Math.PI / 2;
const EJECTION_GAP_SIZE = 0.12;

const BALL_COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c',
  '#3498db', '#9b59b6', '#e91e63', '#00bcd4', '#ff5722',
  '#795548', '#607d8b', '#8bc34a', '#ff9800', '#673ab7',
  '#009688', '#f44336', '#2196f3', '#4caf50', '#ff5252',
];

export class LotteryMachine {
  private engine: Matter.Engine;
  private runner: Matter.Runner;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private resultArea: HTMLElement;
  private controlsEl: HTMLElement;
  private statusEl: HTMLElement;

  private mode: GameMode = '539';
  private state: GameState = 'idle';
  private balls: { body: Matter.Body; number: number; color: string }[] = [];
  private wallBodies: Matter.Body[] = [];
  private drawnNumbers: number[] = [];
  private round1Numbers: number[] = [];
  private fillIndex = 0;
  private fillTimer: ReturnType<typeof setInterval> | null = null;
  private drawTimer: ReturnType<typeof setInterval> | null = null;
  // @ts-ignore used by requestAnimationFrame
  private _animationId: number | null = null;
  private stirAngle = 0;
  private stirDirection = 1;
  private stirFrameCount = 0;
  private stirBodies: Matter.Body[] = [];
  private ejectingBalls: EjectingBall[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    resultArea: HTMLElement,
    controlsEl: HTMLElement,
    statusEl: HTMLElement
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resultArea = resultArea;
    this.controlsEl = controlsEl;
    this.statusEl = statusEl;

    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;

    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 1.5, scale: 0.001 },
    });

    this.runner = Matter.Runner.create();

    this.bindControls();
    this.createWalls();
    this.startRenderLoop();
    this.setStatus('請選擇玩法，然後按「倒入球」');
  }

  setMode(mode: GameMode) {
    if (this.state !== 'idle') this.reset();
    this.mode = mode;
    this.setStatus('請按「倒入球」開始');
  }

  private bindControls() {
    this.controlsEl.querySelector('#btn-start')!.addEventListener('click', () => this.startFill());
    this.controlsEl.querySelector('#btn-draw')!.addEventListener('click', () => this.startDraw());
    this.controlsEl.querySelector('#btn-reset')!.addEventListener('click', () => this.reset());
  }

  private setStatus(text: string) {
    this.statusEl.textContent = text;
  }

  private setButtonStates(start: boolean, draw: boolean, reset: boolean, nextRound = false) {
    const btnStart = this.controlsEl.querySelector('#btn-start') as HTMLButtonElement;
    const btnDraw = this.controlsEl.querySelector('#btn-draw') as HTMLButtonElement;
    const btnReset = this.controlsEl.querySelector('#btn-reset') as HTMLButtonElement;

    btnStart.disabled = !start;
    btnDraw.disabled = !draw;
    btnReset.disabled = !reset;

    const existing = this.controlsEl.querySelector('#btn-next-round');
    if (nextRound && !existing) {
      const btn = document.createElement('button');
      btn.id = 'btn-next-round';
      btn.className = 'ctrl-btn btn-next-round';
      btn.textContent = '第二區開獎';
      btn.addEventListener('click', () => this.startRound2());
      this.controlsEl.insertBefore(btn, btnReset);
    } else if (!nextRound && existing) {
      existing.remove();
    }
  }

  private createWalls() {
    this.wallBodies.forEach(b => Matter.Composite.remove(this.engine.world, b));
    this.wallBodies = [];

    const gapStart = EJECTION_GAP_ANGLE - EJECTION_GAP_SIZE;
    const gapEnd = EJECTION_GAP_ANGLE + EJECTION_GAP_SIZE;

    for (let i = 0; i < WALL_SEGMENTS; i++) {
      const angle1 = (i / WALL_SEGMENTS) * Math.PI * 2;
      const angle2 = ((i + 1) / WALL_SEGMENTS) * Math.PI * 2;

      const midAngle = (angle1 + angle2) / 2;
      if (midAngle > gapStart + Math.PI * 2 - 0.01 || midAngle < gapEnd + Math.PI * 2 + 0.01) {
        const normMid = ((midAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const normGapStart = ((gapStart % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const normGapEnd = ((gapEnd % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (normGapStart > normGapEnd) {
          if (normMid >= normGapStart || normMid <= normGapEnd) continue;
        } else {
          if (normMid >= normGapStart && normMid <= normGapEnd) continue;
        }
      }

      const x1 = CENTER + Math.cos(angle1) * CONTAINER_RADIUS;
      const y1 = CENTER + Math.sin(angle1) * CONTAINER_RADIUS;
      const x2 = CENTER + Math.cos(angle2) * CONTAINER_RADIUS;
      const y2 = CENTER + Math.sin(angle2) * CONTAINER_RADIUS;

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      const ang = Math.atan2(y2 - y1, x2 - x1);

      const wall = Matter.Bodies.rectangle(mx, my, len, 4, {
        isStatic: true,
        restitution: 0.6,
        friction: 0.1,
        angle: ang,
        render: { visible: false },
      });
      this.wallBodies.push(wall);
    }

    Matter.Composite.add(this.engine.world, this.wallBodies);
  }

  private createBall(number: number): { body: Matter.Body; number: number; color: string } {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.4;
    const r = Math.random() * 30;
    const x = CENTER + Math.cos(angle) * r;
    const y = CENTER - CONTAINER_RADIUS + 30 + Math.random() * 20;

    const body = Matter.Bodies.circle(x, y, BALL_RADIUS, {
      restitution: 0.9,
      friction: 0.05,
      frictionAir: 0.001,
      density: 0.002,
    });

    const color = BALL_COLORS[(number - 1) % BALL_COLORS.length];
    return { body, number, color };
  }

  private startFill() {
    if (this.state !== 'idle') return;
    this.state = 'filling';
    this.setButtonStates(false, false, false);
    this.drawnNumbers = [];
    this.round1Numbers = [];
    this.resultArea.innerHTML = '';

    Matter.Runner.run(this.runner, this.engine);

    const config = MODE_CONFIGS[this.mode];
    const numbers = Array.from({ length: config.totalBalls }, (_, i) => i + 1);
    // shuffle for random fill order
    for (let i = numbers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }
    this.fillIndex = 0;

    this.setStatus(`正在倒入 ${config.totalBalls} 顆球...`);

    this.fillTimer = setInterval(() => {
      if (this.fillIndex >= numbers.length) {
        clearInterval(this.fillTimer!);
        this.fillTimer = null;
        this.state = 'mixing';
        this.startStirring();
        this.setButtonStates(false, true, true);
        this.setStatus('按「開獎」抽出號碼');
        return;
      }

      const ball = this.createBall(numbers[this.fillIndex]);
      this.balls.push(ball);
      Matter.Composite.add(this.engine.world, ball.body);
      this.fillIndex++;
    }, 60);
  }

  private startStirring() {
    this.stopStirring();
    this.stirAngle = 0;
    this.stirDirection = 1;
    this.stirFrameCount = 0;

    const armLength = CONTAINER_RADIUS * 1.85;
    const arm1 = Matter.Bodies.rectangle(CENTER, CENTER, armLength, 8, {
      isStatic: true, restitution: 0.9, friction: 0,
    });
    const arm2 = Matter.Bodies.rectangle(CENTER, CENTER, armLength, 8, {
      isStatic: true, restitution: 0.9, friction: 0, angle: Math.PI / 2,
    });

    this.stirBodies = [arm1, arm2];
    Matter.Composite.add(this.engine.world, this.stirBodies);
  }

  private stopStirring() {
    this.stirBodies.forEach(b => Matter.Composite.remove(this.engine.world, b));
    this.stirBodies = [];
  }

  private startDraw() {
    if (this.state === 'mixing') {
      this.state = 'drawing';
      this.setButtonStates(false, false, false);
      this.drawBalls(MODE_CONFIGS[this.mode].drawCount, false);
    } else if (this.state === 'round2-mixing') {
      this.state = 'round2-drawing';
      this.setButtonStates(false, false, false);
      this.drawBalls(SUPER_ROUND2.drawCount, true);
    }
  }

  private drawBalls(count: number, isSpecial: boolean) {
    let drawn = 0;
    this.setStatus('開獎中...');

    this.drawTimer = setInterval(() => {
      if (drawn >= count || this.balls.length === 0) {
        clearInterval(this.drawTimer!);
        this.drawTimer = null;
        this.stopStirring();

        setTimeout(() => {
          if (isSpecial) {
            this.sortAndRenderResults();
            this.state = 'round2-done';
            this.setButtonStates(false, false, true);
            this.setStatus('威力彩開獎完成！');
          } else if (this.mode === 'super') {
            this.round1Numbers = [...this.drawnNumbers];
            this.sortAndRenderResults();
            this.state = 'round2-ready';
            this.setButtonStates(false, false, true, true);
            this.setStatus('第一區完成！按「第二區開獎」繼續');
          } else {
            this.sortAndRenderResults();
            this.state = 'done';
            this.setButtonStates(false, false, true);
            this.setStatus('開獎完成！');
          }
          Matter.Runner.stop(this.runner);
        }, 800);

        return;
      }

      // pick from the 3 balls closest to the top
      const sorted = this.balls
        .map((b, i) => ({ i, y: b.body.position.y }))
        .sort((a, b) => a.y - b.y);
      const topCount = Math.min(3, sorted.length);
      const idx = sorted[Math.floor(Math.random() * topCount)].i;
      const ball = this.balls[idx];
      this.drawnNumbers.push(ball.number);

      this.ejectBall(ball, isSpecial);

      Matter.Composite.remove(this.engine.world, ball.body);
      this.balls.splice(idx, 1);

      drawn++;
      this.setStatus(`開獎中... ${drawn}/${count}`);
    }, 2500);
  }

  private ejectBall(ball: { body: Matter.Body; number: number; color: string }, isSpecial: boolean) {
    const startX = ball.body.position.x;
    const startY = ball.body.position.y;

    // target: top center of container (just inside the wall)
    const topX = CENTER;
    const topY = CENTER - CONTAINER_RADIUS + BALL_RADIUS;

    this.ejectingBalls.push({
      number: ball.number,
      color: ball.color,
      x: startX,
      y: startY,
      vx: 0,
      vy: 0,
      scale: 1,
      opacity: 1,
      trail: [],
      phase: 'attracting',
      targetX: topX,
      targetY: topY,
      struggleFrames: 0,
      isSpecial,
    });
  }

  private sortAndRenderResults() {
    this.resultArea.innerHTML = '';
    const mainNums = this.mode === 'super' ? this.round1Numbers : this.drawnNumbers;
    const sorted = [...mainNums].sort((a, b) => a - b);
    sorted.forEach(n => {
      const el = document.createElement('div');
      el.className = 'result-ball main';
      el.textContent = String(n);
      this.resultArea.appendChild(el);
    });

    if (this.mode === 'super' && this.drawnNumbers.length > this.round1Numbers.length) {
      const specialNums = this.drawnNumbers.slice(this.round1Numbers.length);
      specialNums.forEach(n => {
        const sep = document.createElement('span');
        sep.className = 'result-separator';
        sep.textContent = '+';
        this.resultArea.appendChild(sep);
        const el = document.createElement('div');
        el.className = 'result-ball special';
        el.textContent = String(n);
        this.resultArea.appendChild(el);
      });
    }
  }

  private addResultBall(num: number, isSpecial: boolean) {
    if (isSpecial) {
      const sep = document.createElement('span');
      sep.className = 'result-separator';
      sep.textContent = '+';
      this.resultArea.appendChild(sep);
    }

    const el = document.createElement('div');
    el.className = `result-ball ${isSpecial ? 'special' : 'main'}`;
    el.textContent = String(num);
    this.resultArea.appendChild(el);
  }

  private startRound2() {
    this.balls.forEach(b => Matter.Composite.remove(this.engine.world, b.body));
    this.balls = [];

    this.state = 'filling';
    this.setButtonStates(false, false, false, false);

    Matter.Runner.run(this.runner, this.engine);

    const numbers = Array.from({ length: SUPER_ROUND2.totalBalls }, (_, i) => i + 1);
    for (let i = numbers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }
    this.fillIndex = 0;

    this.setStatus(`正在倒入第二區 ${SUPER_ROUND2.totalBalls} 顆球...`);

    this.fillTimer = setInterval(() => {
      if (this.fillIndex >= numbers.length) {
        clearInterval(this.fillTimer!);
        this.fillTimer = null;
        this.state = 'round2-mixing';
        this.startStirring();
        this.setButtonStates(false, true, true);
        this.setStatus('按「開獎」抽出號碼');
        return;
      }

      const ball = this.createBall(numbers[this.fillIndex]);
      this.balls.push(ball);
      Matter.Composite.add(this.engine.world, ball.body);
      this.fillIndex++;
    }, 100);
  }

  private reset() {
    if (this.fillTimer) clearInterval(this.fillTimer);
    if (this.drawTimer) clearInterval(this.drawTimer);
    this.fillTimer = null;
    this.drawTimer = null;

    this.stopStirring();

    this.balls.forEach(b => Matter.Composite.remove(this.engine.world, b.body));
    this.balls = [];
    this.drawnNumbers = [];
    this.round1Numbers = [];
    this.ejectingBalls = [];

    Matter.Runner.stop(this.runner);

    this.state = 'idle';
    this.resultArea.innerHTML = '';
    this.setButtonStates(true, false, false);
    this.setStatus('請按「倒入球」開始');
  }

  private startRenderLoop() {
    const render = () => {
      this._animationId = requestAnimationFrame(render);
      this.update();
      this.draw();
    };
    render();
  }

  private update() {
    const isActive = this.state === 'mixing' || this.state === 'round2-mixing' || this.state === 'drawing' || this.state === 'round2-drawing';

    if (this.stirBodies.length > 0 && isActive) {
      // reverse direction every ~3 seconds (180 frames)
      this.stirFrameCount++;
      if (this.stirFrameCount % 180 === 0) {
        this.stirDirection *= -1;
      }
      this.stirAngle += 0.07 * this.stirDirection;
      this.stirBodies.forEach((arm, i) => {
        Matter.Body.setAngle(arm, this.stirAngle + (i * Math.PI / 2));
        Matter.Body.setPosition(arm, { x: CENTER, y: CENTER });
      });

      // random force impulse — strong lateral + upward
      if (this.balls.length > 0 && Math.random() < 0.5) {
        const ball = this.balls[Math.floor(Math.random() * this.balls.length)];
        const fx = (Math.random() - 0.5) * 0.03;
        const fy = (Math.random() - 0.5) * 0.03 - 0.01;
        Matter.Body.applyForce(ball.body, ball.body.position, { x: fx, y: fy });
      }

      // anti-clustering: detect center of mass and push balls away from it
      if (this.balls.length > 2) {
        let cx = 0, cy = 0;
        this.balls.forEach(b => { cx += b.body.position.x; cy += b.body.position.y; });
        cx /= this.balls.length;
        cy /= this.balls.length;

        const offsetX = cx - CENTER;
        const offsetY = cy - CENTER;
        const drift = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

        if (drift > 30) {
          const correctionStrength = 0.003 * (drift / CONTAINER_RADIUS);
          this.balls.forEach(ball => {
            if (Math.random() < 0.3) {
              Matter.Body.applyForce(ball.body, ball.body.position, {
                x: -offsetX / drift * correctionStrength,
                y: -offsetY / drift * correctionStrength,
              });
            }
          });
        }
      }

      // bottom push — upward force for balls in lower region
      this.balls.forEach(ball => {
        const dy = ball.body.position.y - CENTER;
        if (dy > CONTAINER_RADIUS * 0.3) {
          const strength = ((dy - CONTAINER_RADIUS * 0.3) / (CONTAINER_RADIUS * 0.7)) * 0.015;
          if (Math.random() < 0.4) {
            Matter.Body.applyForce(ball.body, ball.body.position, {
              x: (Math.random() - 0.5) * 0.008,
              y: -strength,
            });
          }
        }
      });
    }

    // update ejecting balls
    this.ejectingBalls.forEach(eb => {
      eb.trail.push({ x: eb.x, y: eb.y, opacity: 0.7 });
      if (eb.trail.length > 18) eb.trail.shift();

      if (eb.phase === 'attracting') {
        // sucked toward the top of container
        const dx = eb.targetX - eb.x;
        const dy = eb.targetY - eb.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 5) {
          eb.x = eb.targetX;
          eb.y = eb.targetY;
          eb.phase = 'struggling';
          eb.struggleFrames = 0;
        } else {
          const speed = Math.max(3, dist * 0.08);
          eb.x += (dx / dist) * speed;
          eb.y += (dy / dist) * speed;
        }
      } else if (eb.phase === 'struggling') {
        // vibrate at the top wall
        eb.struggleFrames++;
        eb.x = eb.targetX + (Math.random() - 0.5) * 6;
        eb.y = eb.targetY + (Math.random() - 0.5) * 4;
        eb.scale = 0.85 + Math.random() * 0.3;

        if (eb.struggleFrames > 40) {
          eb.phase = 'rising';
          eb.vy = -5;
          eb.vx = 0;
        }
      } else if (eb.phase === 'rising') {
        // break through and fly out
        eb.vy *= 1.12;
        eb.x += eb.vx;
        eb.y += eb.vy;
        eb.scale = 1;

        if (eb.y < CENTER - CONTAINER_RADIUS - 55) {
          eb.phase = 'done';
          this.addResultBall(eb.number, eb.isSpecial);
        }
      }

      eb.trail.forEach(t => { t.opacity *= 0.85; });
      eb.trail = eb.trail.filter(t => t.opacity > 0.03);
    });
    this.ejectingBalls = this.ejectingBalls.filter(eb => eb.phase !== 'done' || eb.trail.length > 0);

    this.balls.forEach(ball => {
      const dx = ball.body.position.x - CENTER;
      const dy = ball.body.position.y - CENTER;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > CONTAINER_RADIUS + BALL_RADIUS + 50) {
        Matter.Body.setPosition(ball.body, { x: CENTER, y: CENTER - 50 });
        Matter.Body.setVelocity(ball.body, { x: 0, y: 0 });
      }
    });
  }

  private draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    this.drawContainer(ctx);

    if (this.stirBodies.length > 0 && (this.state === 'mixing' || this.state === 'round2-mixing' || this.state === 'drawing' || this.state === 'round2-drawing')) {
      this.drawStirrer(ctx);
    }

    this.balls.forEach(ball => this.drawBall(ctx, ball));

    this.ejectingBalls.forEach(eb => this.drawEjectingBall(ctx, eb));
  }

  private drawEjectingBall(ctx: CanvasRenderingContext2D, eb: EjectingBall) {
    ctx.save();

    // draw trail
    eb.trail.forEach((t, i) => {
      const trailR = BALL_RADIUS * (0.3 + 0.7 * (i / eb.trail.length));
      ctx.beginPath();
      ctx.arc(t.x, t.y, trailR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 200, 50, ${t.opacity * 0.4})`;
      ctx.fill();
    });

    if (eb.phase !== 'done') {
      const r = BALL_RADIUS * eb.scale;

      // glow — stronger when struggling/rising
      const glowAlpha = eb.phase === 'attracting' ? 0.2 : 0.5;
      const glowSize = eb.phase === 'struggling' ? 3 : 2.5;
      const glowGrad = ctx.createRadialGradient(eb.x, eb.y, r, eb.x, eb.y, r * glowSize);
      glowGrad.addColorStop(0, `rgba(255, 220, 80, ${glowAlpha})`);
      glowGrad.addColorStop(1, 'rgba(255, 220, 80, 0)');
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, r * glowSize, 0, Math.PI * 2);
      ctx.fillStyle = glowGrad;
      ctx.fill();

      // ball
      const grad = ctx.createRadialGradient(eb.x - r * 0.3, eb.y - r * 0.3, r * 0.1, eb.x, eb.y, r);
      grad.addColorStop(0, lightenColor(eb.color, 60));
      grad.addColorStop(0.6, eb.color);
      grad.addColorStop(1, darkenColor(eb.color, 20));

      ctx.beginPath();
      ctx.arc(eb.x, eb.y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // highlight
      ctx.beginPath();
      ctx.arc(eb.x - r * 0.25, eb.y - r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fill();

      // number
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r * 0.85}px 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 3;
      ctx.fillText(String(eb.number), eb.x, eb.y + 1);
    }

    ctx.restore();
  }

  private drawContainer(ctx: CanvasRenderingContext2D) {
    ctx.save();

    const grad = ctx.createRadialGradient(CENTER, CENTER, CONTAINER_RADIUS - 30, CENTER, CENTER, CONTAINER_RADIUS + 10);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.7, 'rgba(40, 40, 80, 0.3)');
    grad.addColorStop(1, 'rgba(20, 20, 50, 0.6)');

    ctx.beginPath();
    ctx.arc(CENTER, CENTER, CONTAINER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(CENTER, CENTER, CONTAINER_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(150, 150, 200, 0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(CENTER, CENTER, CONTAINER_RADIUS + 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(100, 100, 160, 0.3)';
    ctx.lineWidth = 6;
    ctx.stroke();

    const highlightGrad = ctx.createLinearGradient(
      CENTER - CONTAINER_RADIUS, CENTER - CONTAINER_RADIUS,
      CENTER + CONTAINER_RADIUS * 0.3, CENTER - CONTAINER_RADIUS * 0.3
    );
    highlightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    highlightGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.03)');
    highlightGrad.addColorStop(1, 'transparent');

    ctx.beginPath();
    ctx.arc(CENTER, CENTER, CONTAINER_RADIUS - 2, 0, Math.PI * 2);
    ctx.fillStyle = highlightGrad;
    ctx.fill();

    ctx.restore();
  }

  private drawStirrer(ctx: CanvasRenderingContext2D) {
    const halfLen = CONTAINER_RADIUS * 0.88;
    ctx.save();
    ctx.translate(CENTER, CENTER);

    for (let i = 0; i < 2; i++) {
      ctx.save();
      ctx.rotate(this.stirAngle + (i * Math.PI / 2));
      ctx.beginPath();
      ctx.moveTo(-halfLen, 0);
      ctx.lineTo(halfLen, 0);
      ctx.strokeStyle = 'rgba(180, 180, 220, 0.35)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200, 200, 240, 0.5)';
    ctx.fill();

    ctx.restore();
  }

  private drawBall(ctx: CanvasRenderingContext2D, ball: { body: Matter.Body; number: number; color: string }) {
    const { x, y } = ball.body.position;
    const r = BALL_RADIUS;

    ctx.save();

    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    grad.addColorStop(0, lightenColor(ball.color, 40));
    grad.addColorStop(0.6, ball.color);
    grad.addColorStop(1, darkenColor(ball.color, 30));

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fill();

    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${r * 0.85}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(ball.number), x, y + 1);

    ctx.restore();
  }
}

function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}

function darkenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `rgb(${r},${g},${b})`;
}
