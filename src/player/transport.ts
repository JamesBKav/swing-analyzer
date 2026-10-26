import { h, icon } from '../ui/dom';
import { SPEEDS, type VideoPlayer } from './player';
import { Scrubber } from './scrubber';

/** Press-and-hold auto-repeat for frame-step buttons. */
function holdRepeat(btn: HTMLElement, action: () => Promise<void> | void) {
  let timer = 0;
  let active = false;
  const run = async () => {
    if (!active) return;
    await action();
    if (active) timer = window.setTimeout(run, 60);
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    active = true;
    void action();
    timer = window.setTimeout(run, 380);
  });
  const stop = () => {
    active = false;
    clearTimeout(timer);
  };
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('pointerleave', stop);
}

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/** Scrub bar + play/step buttons + speed selector, bound to a player. */
export function createTransport(player: VideoPlayer) {
  let wasPlaying = false;
  const scrubber = new Scrubber(
    (t) => void player.seekFrameAt(t),
    () => {
      wasPlaying = player.playing;
      player.pause();
    },
    () => {
      if (wasPlaying) void player.play();
    },
  );

  const readout = h('div', { class: 'readout' });
  const playBtn = h('button', { class: 'btn round primary big', 'aria-label': 'Play/pause', onclick: () => player.toggle() });
  const backBtn = h('button', { class: 'btn round big', 'aria-label': 'Previous frame' }, icon('stepBack'));
  const fwdBtn = h('button', { class: 'btn round big', 'aria-label': 'Next frame' }, icon('stepFwd'));
  holdRepeat(backBtn, () => player.step(-1));
  holdRepeat(fwdBtn, () => player.step(1));

  const speedBtns = SPEEDS.map((s) =>
    h('button', { class: 'seg', onclick: () => player.setRate(s) }, s === 1 ? '1×' : `${s}×`),
  );
  const speed = h('div', { class: 'segmented speed' }, speedBtns);

  const el = h(
    'div',
    { class: 'transport' },
    scrubber.el,
    h('div', { class: 'transport-row' }, speed, readout),
    h('div', { class: 'transport-row center' }, backBtn, playBtn, fwdBtn),
  );

  const renderState = () => {
    playBtn.replaceChildren(icon(player.playing ? 'pause' : 'play'));
    speedBtns.forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === player.rate));
  };
  const renderTime = () => {
    scrubber.setValue(player.displayTime);
    readout.textContent = `${formatTime(player.displayTime)} · f ${player.frameIndex() + 1}/${player.frameCount}`;
  };
  player.addEventListener('state', renderState);
  player.addEventListener('time', renderTime);
  player.addEventListener('loaded', () => {
    scrubber.setDuration(player.duration);
    renderTime();
  });
  scrubber.setDuration(player.duration);
  renderState();
  renderTime();

  return { el, scrubber, renderTime };
}
