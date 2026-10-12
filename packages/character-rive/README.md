# @sunny/character-rive

Plays the animator-authored Rive Sunny (ADR-007) against the contract in
`docs/design/rive-animator-brief.md` §5. The application keeps deciding _what_
Sunny is doing; the `.riv` file decides how it looks.

## Usage

```ts
import { SunnyAnimator } from '@sunny/animation-engine';
import { connectAnimator, mountRiveSunny } from '@sunny/character-rive';

const sunny = mountRiveSunny(hostElement, {
  src: '/assets/sunny.riv',
  wasmUrl: '/assets/rive.wasm', // self-host in production
  color: tenant.themeColor, // '#rgb' or '#rrggbb', anything else is refused
  intensity: tenant.animationIntensity,
  fallback: (host) => drawStaticSunny(host), // no WASM, or the file failed
  onError: (error) => log.warn(error.kind, error.message),
});

// The existing state machine stays in charge; this forwards its state.
const animator = new SunnyAnimator();
const link = connectAnimator(sunny, animator);
// ...after each animator.dispatch(...) or once per frame:
link.sync();

sunny.fire('sunglasses'); // one-shot moments
sunny.look(40, -20); // eye aim, -100..100
sunny.on('openExpand', () => panel.open()); // signals from the file
sunny.interrupt(); // any user input during a moment
```

`mountRiveSunny` never throws into the host page. `ready` resolves `true` when
the file plays and `false` when it fell back. Setters may be called before
load: the latest value is applied once the file is ready, and unchanged values
are not rewritten. Playback pauses off screen and in hidden tabs, and
`prefers-reduced-motion` is followed live unless overridden.

## When the animator delivers `sunny.riv`

1. Put `sunny.riv` (and later `sunny-props.riv`) where the host serves static
   assets, and copy `node_modules/@rive-app/canvas-lite/rive.wasm` alongside
   it for `wasmUrl`.
2. Mount it and read `controller.missing` after `ready`: it lists every
   contract name the file lacks, and `onError` reports the same list once
   with `kind: 'contract'`. An empty list is acceptance criterion 6 of the
   brief.
3. Check the rest pose against `sunny.png`, and each moment and its
   `interrupt` behaviour, before any visual baselines are recaptured.

## Changing the contract

`src/contract.ts` is the single source of truth in code. A test fails if a
name there is not written out in the brief, so update both together and tell
the animator before they rig against the old names.
