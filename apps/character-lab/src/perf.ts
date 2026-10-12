import { SunnyAnimator } from '@sunny/animation-engine';
import { cartoonClock, createSunnyView, defaultRig } from '@sunny/character';

/**
 * Performance harness: the same loop the website hero and the widget launcher
 * run (animator → cartoon clock → persistent view with the ink boil), at hero
 * size (460px) and launcher size (72px), cycling through the expensive moments
 * so frame times can be measured. `scripts/perf-character.mjs` drives it.
 */

const hero = document.getElementById('hero')!;
const launcher = document.getElementById('launcher')!;
const heroView = createSunnyView(hero, { decorative: true });
const launcherView = createSunnyView(launcher, { decorative: true });

const heroSunny = new SunnyAnimator(defaultRig(), { intensity: 'playful' });
const launcherSunny = new SunnyAnimator(defaultRig(), { intensity: 'balanced' });

// Cycle through moments that exercise limbs, props and the whole body.
const MOMENTS = ['celebrate', 'cool', 'relax', 'play', 'eureka', 'confused'] as const;
let next = 0;
setInterval(() => {
  const now = cartoonClock(performance.now()).time;
  const group = MOMENTS[next++ % MOMENTS.length]!;
  heroSunny.reset();
  if (group === 'relax') {
    heroSunny.dispatch({ type: 'attention' }, now);
    heroSunny.dispatch({ type: 'dismissed' }, now);
  } else if (group === 'eureka') {
    heroSunny.dispatch({ type: 'turn_started' }, now);
    heroSunny.dispatch({ type: 'speaking_started' }, now);
  } else if (group === 'play') {
    heroSunny.dispatch({ type: 'play_started' }, now);
  } else {
    heroSunny.dispatch({ type: 'idle' }, now);
    heroSunny.play(group, now);
  }
}, 2500);

/** Per-frame JavaScript cost (animator + render + DOM update), for the script. */
const work: number[] = [];
(window as unknown as { __work: number[] }).__work = work;

function tick(now: number): void {
  const started = performance.now();
  const clock = cartoonClock(now);
  heroView.draw(heroSunny.frame(clock.time).rig, { boil: clock.boil });
  launcherView.draw(launcherSunny.frame(clock.time).rig, { boil: clock.boil });
  work.push(performance.now() - started);
  if (work.length > 2000) work.splice(0, 1000);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
