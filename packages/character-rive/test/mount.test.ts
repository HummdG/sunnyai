import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectAnimator } from '../src/connect.js';
import type { SunnyState } from '../src/contract.js';
import { mountRiveSunny, type MountOptions, type RiveSunnyError } from '../src/mount.js';
import {
  FakeElement,
  FakeObserver,
  FakeViewModel,
  fakeEnvironment,
  fakeRuntime,
  type FakeEnv,
  type FakeRuntime,
} from './fakes.js';

let host: FakeElement;
let fake: FakeEnv;
let runtime: FakeRuntime;
let errors: RiveSunnyError[];

function mount(extra: Partial<MountOptions> = {}) {
  return mountRiveSunny(host as unknown as HTMLElement, {
    src: '/sunny.riv',
    loadRuntime: () => Promise.resolve(runtime),
    environment: fake.env,
    onError: (e) => errors.push(e),
    ...extra,
  });
}

function vm(index = 0): FakeViewModel {
  const instance = runtime.instances[index];
  if (!instance?.viewModelInstance) throw new Error('no view model');
  return instance.viewModelInstance;
}

beforeEach(() => {
  host = new FakeElement();
  fake = fakeEnvironment();
  runtime = fakeRuntime();
  errors = [];
  FakeObserver.instances = [];
});

describe('loading', () => {
  it('creates the canvas, binds the view model and reports ready', async () => {
    const c = mount({ wasmUrl: '/rive.wasm' });
    expect(await c.ready).toBe(true);
    const rive = runtime.instances[0]!;
    expect(rive.params.artboard).toBe('Sunny');
    expect(rive.params.stateMachine).toBe('SunnyMachine');
    expect(rive.params.autoBind).toBe(true);
    expect(rive.params.autoplay).toBe(false);
    expect(rive.params.isTouchScrollEnabled).toBe(true);
    expect(rive.resizes).toBe(1);
    expect(runtime.wasmUrl).toBe('/rive.wasm');
    expect(host.children).toHaveLength(1);
    expect((host.children[0] as FakeElement).tagName).toBe('canvas');
    expect(c.missing).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('writes the initial values to the view model on load', async () => {
    const c = mount({ intensity: 'playful', color: '#7c3aed', season: 'winter' });
    await c.ready;
    expect(vm().get('state').value).toBe('idle');
    expect(vm().get('intensity').value).toBe('playful');
    expect(vm().get('season').value).toBe('winter');
    expect(vm().get('bodyColor').value).toBe(0xff7c3aed);
    expect(vm().get('reducedMotion').value).toBe(false);
  });

  it('falls back when the file fails to load, without throwing', async () => {
    runtime = fakeRuntime('error');
    const fallback = vi.fn((h: HTMLElement) => h.setAttribute('data-fallback', ''));
    const c = mount({ fallback });
    expect(await c.ready).toBe(false);
    expect(fallback).toHaveBeenCalledOnce();
    expect(host.attributes['data-fallback']).toBe('');
    expect(runtime.instances[0]!.cleaned).toBe(true);
    expect(errors.map((e) => e.kind)).toEqual(['load']);
  });

  it('falls back when the runtime itself fails to load', async () => {
    const fallback = vi.fn();
    const c = mount({
      fallback,
      loadRuntime: () => Promise.reject(new Error('network')),
    });
    expect(await c.ready).toBe(false);
    expect(fallback).toHaveBeenCalledOnce();
    expect(errors[0]!.kind).toBe('load');
  });

  it('falls back without WebAssembly and never touches the runtime', async () => {
    fake = fakeEnvironment({ wasm: false });
    const loadRuntime = vi.fn(() => Promise.resolve(runtime));
    const fallback = vi.fn();
    const c = mount({ fallback, loadRuntime });
    expect(await c.ready).toBe(false);
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
    expect(errors[0]!.kind).toBe('unsupported');
  });

  it('survives a fallback and an error handler that both throw', async () => {
    runtime = fakeRuntime('error');
    const c = mount({
      fallback: () => {
        throw new Error('fallback broke');
      },
      onError: () => {
        throw new Error('handler broke');
      },
    });
    await expect(c.ready).resolves.toBe(false);
  });

  it('names contract gaps in the delivered file, and still plays', async () => {
    runtime = fakeRuntime('load', () => new FakeViewModel(['iceCream', 'openSettled', 'lookX']));
    const c = mount();
    expect(await c.ready).toBe(true);
    expect([...c.missing].sort()).toEqual(['iceCream', 'lookX', 'openSettled']);
    expect(errors.map((e) => e.kind)).toEqual(['contract']);
    c.look(10, 10); // a missing property is skipped, not thrown on
    expect(vm().get('lookY').value).toBe(10);
  });

  it('reports a file with no view model', async () => {
    runtime = fakeRuntime('load', () => null);
    const c = mount();
    expect(await c.ready).toBe(true);
    expect(c.missing).toHaveLength(1);
    expect(errors[0]!.kind).toBe('contract');
    expect(() => c.setState('thinking')).not.toThrow();
  });
});

describe('inputs', () => {
  it('forwards values and does not rewrite an unchanged one', async () => {
    const c = mount();
    await c.ready;
    const state = vm().get('state');
    state.writes = [];
    c.setState('thinking');
    c.setState('thinking');
    c.setState('speaking');
    expect(state.writes).toEqual(['thinking', 'speaking']);
  });

  it('applies the latest pre-load value, once', async () => {
    const c = mount();
    c.setState('listening');
    c.setState('thinking');
    c.look(500, -500);
    await c.ready;
    expect(vm().get('state').writes).toEqual(['thinking']);
    expect(vm().get('lookX').value).toBe(100);
    expect(vm().get('lookY').value).toBe(-100);
  });

  it('ignores states, intensities and seasons outside the contract', async () => {
    const c = mount();
    await c.ready;
    c.setState('dancing' as SunnyState);
    c.setIntensity('maximum' as never);
    c.setSeason('monsoon' as never);
    expect(vm().get('state').value).toBe('idle');
    expect(vm().get('intensity').value).toBe('balanced');
    expect(vm().get('season').value).toBe('none');
  });

  it('normalises the pointing angle and clamps non-finite input', async () => {
    const c = mount();
    await c.ready;
    c.point(-90);
    expect(vm().get('pointAngle').value).toBe(270);
    c.point(725);
    expect(vm().get('pointAngle').value).toBe(5);
    c.look(Number.NaN, Infinity);
    expect(vm().get('lookX').value).toBe(0);
    expect(vm().get('lookY').value).toBe(0);
  });

  it('accepts only hex colours', async () => {
    const c = mount();
    await c.ready;
    expect(c.setColor('#16a34a')).toBe(true);
    expect(vm().get('bodyColor').value).toBe(0xff16a34a);
    expect(c.setColor('red; fill: url(x)')).toBe(false);
    expect(vm().get('bodyColor').value).toBe(0xff16a34a);
  });

  it('rejects a bad initial colour and leaves the authored colour alone', async () => {
    const c = mount({ color: 'javascript:alert(1)' });
    await c.ready;
    expect(vm().get('bodyColor').writes).toEqual([]);
    expect(errors.map((e) => e.kind)).toEqual(['runtime']);
  });

  it('fires triggers, keeping only the latest one requested before load', async () => {
    const c = mount();
    c.fire('sunglasses');
    c.fire('eureka');
    await c.ready;
    expect(vm().get('sunglasses').fired).toBe(0);
    expect(vm().get('eureka').fired).toBe(1);
    c.fire('charge');
    c.interrupt();
    expect(vm().get('charge').fired).toBe(1);
    expect(vm().get('interrupt').fired).toBe(1);
    c.fire('not-a-trigger' as never);
  });

  it('drops a pre-load moment when interrupted before load', async () => {
    const c = mount();
    c.fire('open');
    c.interrupt();
    await c.ready;
    expect(vm().get('open').fired).toBe(0);
  });
});

describe('signals', () => {
  it('delivers signals from the file with the moment named', async () => {
    const c = mount();
    await c.ready;
    const seen: unknown[] = [];
    const off = c.on('momentFinished', (e) => seen.push(e));
    c.on('openExpand', (e) => seen.push(e));
    vm().get('moment').value = 'iceCream';
    vm().get('momentFinished').trigger();
    vm().get('openExpand').trigger();
    vm().get('moment').value = 'something-else';
    vm().get('momentFinished').trigger();
    off();
    vm().get('momentFinished').trigger();
    expect(seen).toEqual([
      { signal: 'momentFinished', moment: 'iceCream' },
      { signal: 'openExpand', moment: null },
      { signal: 'momentFinished', moment: null },
    ]);
  });

  it('isolates a throwing listener', async () => {
    const c = mount();
    await c.ready;
    const after = vi.fn();
    c.on('popHit', () => {
      throw new Error('listener broke');
    });
    c.on('popHit', after);
    vm().get('popHit').trigger();
    expect(after).toHaveBeenCalledOnce();
    expect(errors.map((e) => e.kind)).toEqual(['runtime']);
  });
});

describe('playback', () => {
  it('plays only while on screen and the tab is visible', async () => {
    const c = mount();
    await c.ready;
    const rive = runtime.instances[0]!;
    expect(rive.plays).toBe(1);

    fake.setHidden(true);
    expect(rive.pauses).toBe(1);
    fake.setHidden(false);
    expect(rive.plays).toBe(2);

    fake.intersection().callback([{ isIntersecting: false }]);
    expect(rive.pauses).toBe(2);
    fake.intersection().callback([{ isIntersecting: false }]);
    expect(rive.pauses).toBe(2); // no duplicate pause
    fake.intersection().callback([{ isIntersecting: true }]);
    expect(rive.plays).toBe(3);
  });

  it('starts paused when mounted off screen', async () => {
    const c = mount();
    fake.intersection().callback([{ isIntersecting: false }]);
    await c.ready;
    expect(runtime.instances[0]!.plays).toBe(0);
  });

  it('resizes the drawing surface when the host resizes', async () => {
    const c = mount();
    await c.ready;
    fake.resize().callback([]);
    expect(runtime.instances[0]!.resizes).toBe(2);
  });
});

describe('reduced motion', () => {
  it('follows prefers-reduced-motion live in auto mode', async () => {
    fake = fakeEnvironment({ reduced: true });
    const c = mount();
    await c.ready;
    const reduced = vm().get('reducedMotion');
    expect(reduced.value).toBe(true);
    fake.setReducedMotion(false);
    expect(reduced.value).toBe(false);
  });

  it('lets an explicit setting override the media query', async () => {
    fake = fakeEnvironment({ reduced: false });
    const c = mount({ reducedMotion: true });
    await c.ready;
    expect(vm().get('reducedMotion').value).toBe(true);
    fake.setReducedMotion(false);
    expect(vm().get('reducedMotion').value).toBe(true);
    c.setReducedMotion('auto');
    expect(vm().get('reducedMotion').value).toBe(false);
  });
});

describe('destroy', () => {
  it('releases the runtime, observers and listeners', async () => {
    const c = mount();
    await c.ready;
    c.on('openSettled', () => {});
    c.destroy();
    expect(runtime.instances[0]!.cleaned).toBe(true);
    expect(fake.intersection().disconnected).toBe(true);
    expect(fake.resize().disconnected).toBe(true);
    expect(fake.listenerCount()).toBe(0);
    expect(vm().get('openSettled').callbacks.size).toBe(0);
    expect(host.children).toEqual([]);
    expect(() => c.setState('thinking')).not.toThrow();
    c.destroy();
  });

  it('does not start playing if destroyed before load finishes', async () => {
    const c = mount();
    c.destroy();
    expect(await c.ready).toBe(false);
    expect(runtime.instances.every((r) => r.plays === 0)).toBe(true);
  });
});

describe('connectAnimator', () => {
  it('forwards state changes only', () => {
    const animator = { state: 'idle' as SunnyState };
    const setState = vi.fn();
    const connection = connectAnimator({ setState }, animator);
    expect(setState).toHaveBeenCalledWith('idle');
    connection.sync();
    connection.sync();
    animator.state = 'thinking';
    connection.sync();
    connection.sync();
    animator.state = 'speaking';
    connection.sync();
    expect(setState.mock.calls.map((call) => call[0])).toEqual(['idle', 'thinking', 'speaking']);
  });

  it('drives a mounted controller end to end', async () => {
    const c = mount();
    await c.ready;
    const animator = { state: 'idle' as SunnyState };
    const connection = connectAnimator(c, animator);
    animator.state = 'celebrating';
    connection.sync();
    expect(vm().get('state').value).toBe('celebrating');
  });
});
