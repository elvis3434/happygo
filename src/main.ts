import './style.css';
import { LotteryMachine } from './LotteryMachine';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div class="header">
    <h1>HappyGo 開獎模擬器</h1>
  </div>
  <div class="mode-selector">
    <button class="mode-btn active" data-mode="539">今彩539</button>
    <button class="mode-btn" data-mode="lotto">大樂透</button>
    <button class="mode-btn" data-mode="super">威力彩</button>
  </div>
  <div class="result-area" id="result-area"></div>
  <div class="game-area">
    <canvas id="canvas"></canvas>
  </div>
  <div class="controls" id="controls">
    <button class="ctrl-btn btn-start" id="btn-start">倒入球</button>
    <button class="ctrl-btn btn-draw" id="btn-draw" disabled>開獎</button>
    <button class="ctrl-btn btn-reset" id="btn-reset" disabled>重來</button>
  </div>
  <div class="status-text" id="status"></div>
  <div class="footer">僅供娛樂，謹慎投注；日行一善、助人為本。<br>By eLvis 26-0511</div>
`;

const machine = new LotteryMachine(
  document.getElementById('canvas') as HTMLCanvasElement,
  document.getElementById('result-area')!,
  document.getElementById('controls')!,
  document.getElementById('status')!
);

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    machine.setMode((btn as HTMLElement).dataset.mode as '539' | 'lotto' | 'super');
  });
});
