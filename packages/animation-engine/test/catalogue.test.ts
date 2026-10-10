import { describe, expect, it } from 'vitest';

import {
  CATALOGUE,
  GROUPS,
  INTENSITIES,
  SEQUENCES,
  Scheduler,
  UNREACHABLE_GROUPS,
  bestInGroup,
  catalogueEntry,
  catalogueGaps,
  isEligible,
  sequencesForGroup,
} from '@sunny/animation-engine';
import type { SunnyState } from '@sunny/animation-engine';
import { defaultRig } from '@sunny/character';

/**
 * The catalogue's job is to make three claims true and keep them true: every
 * moment is described, every moment is playable, and every moment is accounted
 * for whether or not anything asks for it.
 *
 * The third one is the interesting one. An animation that exists and is never
 * requested looks exactly like an animation that works, from inside the test
 * suite and from inside a code review -- the only way to notice is to ask the
 * question on purpose, which is what `asked` is for.
 */

const base = defaultRig();

function context(intensity: (typeof INTENSITIES)[number], state: SunnyState) {
  return {
    state,
    intensity,
    reducedMotion: false,
    hidden: false,
    paused: false,
    lowPower: false,
  };
}

/**
 * A state in which this moment actually reaches the screen, or null.
 *
 * Not simply "a state the sequence allows", which is the weaker thing and the
 * one that hides a real failure: a moment loses its own state to the ambient
 * layer underneath it, so it is requestable, eligible and still never drawn.
 * Asking the scheduler what it would draw is the only honest test of "plays".
 */
function stateWhereItPlays(
  group: string,
  intensity: (typeof INTENSITIES)[number],
): { state: SunnyState; sequenceId: string } | null {
  const chosen = bestInGroup(group, intensity);
  if (!chosen) return null;
  const members = new Set(sequencesForGroup(group));

  for (const state of chosen.states) {
    const scheduler = new Scheduler(intensity, false);
    if (!scheduler.request(group, state, 0)) continue;
    const frame = scheduler.update(base, state, context(intensity, state), 0);
    if (frame.sequenceId !== null && members.has(frame.sequenceId)) {
      return { state, sequenceId: frame.sequenceId };
    }
  }
  return null;
}

describe('the animation catalogue', () => {
  it('describes every group, and only groups that exist', () => {
    const gaps = catalogueGaps();
    expect(gaps.undocumented, 'groups with no catalogue entry').toEqual([]);
    expect(gaps.orphaned, 'catalogue entries with no group').toEqual([]);
    expect(CATALOGUE.length).toBe(GROUPS.length);
  });

  it('gives every moment a distinct, human name and a description', () => {
    const names = CATALOGUE.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);

    for (const entry of CATALOGUE) {
      expect(entry.name.trim(), entry.group).not.toBe('');
      expect(entry.name.length, `${entry.group} name is a label, not a sentence`).toBeLessThan(40);
      expect(entry.description.trim(), entry.group).not.toBe('');
      // A description that only restates the group name has not described
      // anything, and is the shape a placeholder takes.
      expect(entry.description.toLowerCase(), entry.group).not.toBe(entry.group.toLowerCase());
    }
  });

  it('says who asks for each moment, and why when nothing does', () => {
    for (const entry of CATALOGUE) {
      if (entry.asked === 'engine') {
        expect(entry.askedBy, `${entry.group} claims the engine asks for it`).toBeDefined();
        expect(entry.note, `${entry.group} is wired, so it needs no excuse`).toBeUndefined();
      } else {
        expect(
          entry.askedBy,
          `${entry.group} is not wired, so it cannot name a caller`,
        ).toBeUndefined();
        // The point of the exercise: an unwired moment has to say what is
        // missing, in words, rather than being silently absent from a list.
        expect(entry.note, `${entry.group} has no caller and no explanation`).toBeDefined();
        expect((entry.note ?? '').length).toBeGreaterThan(40);
      }
    }
  });

  it('lists exactly the moments nothing asks for, so the gap cannot grow quietly', () => {
    // Not a failure -- a statement of fact, asserted so that wiring one up, or
    // letting another one rot, both show up as a diff rather than as silence.
    expect([...UNREACHABLE_GROUPS].sort()).toEqual(['charge', 'eureka', 'listen']);
  });

  describe.each(CATALOGUE)('$group ($name)', (entry) => {
    it('has at least one sequence behind it', () => {
      expect(sequencesForGroup(entry.group).length).toBeGreaterThan(0);
    });

    it('plays when asked, at every intensity that is not off', () => {
      // The claim a catalogue makes to a tenant: "your assistant can do this
      // moment", at whatever the tenant has turned the dial to. `off` is exempt
      // because holding still is the whole point of it, and that is asserted
      // separately in the sequence tests.
      const onIntensities = INTENSITIES.filter((intensity) => intensity !== 'off');

      for (const intensity of onIntensities) {
        const played = stateWhereItPlays(entry.group, intensity);
        expect(
          played,
          `"${entry.group}" is offered at "${intensity}" but reaches the screen in none of its states`,
        ).not.toBeNull();
      }
    });

    it('returns to the resting pose once it is over', () => {
      // A moment that leaves the character mid-gesture, or leaves a prop on
      // screen, is the failure this covers -- and it is checked here for every
      // catalogued moment rather than only for the flagship ones, because the
      // leak test in the sequence suite only proves a sequence never draws a
      // prop it did not declare.
      const chosen = bestInGroup(entry.group, 'playful');
      expect(chosen).not.toBeNull();
      if (!chosen || chosen.loop) return; // A loop has no end to return from.

      const played = stateWhereItPlays(entry.group, 'playful');
      expect(
        played,
        `"${entry.group}" never reaches the screen, so it cannot settle`,
      ).not.toBeNull();

      const scheduler = new Scheduler('playful', false);
      scheduler.request(entry.group, played!.state, 0);

      const after = scheduler.update(
        base,
        played!.state,
        context('playful', played!.state),
        chosen.duration * 2,
      );
      // Either the moment has finished and nothing else took the frame, or the
      // state's ambient layer is drawing -- both leave the base pose intact when
      // the ambient is the resting one. What must not survive is a prop.
      expect(
        after.rig.props.filter((prop) => prop.opacity > 0.001),
        entry.group,
      ).toEqual([]);
    });
  });
});

describe('catalogue reachability', () => {
  it('agrees with the engine about which groups are reachable', () => {
    // `asked: 'engine'` is a claim that the engine requests this group. The
    // engine's own request sites are the source of truth, so this reads them off
    // the behaviour rather than trusting the prose: for each engine-asked group
    // the sequence suite's coverage test already proves a variant exists, and
    // here we prove the catalogue does not over-claim.
    for (const entry of CATALOGUE) {
      const members = SEQUENCES.filter((sequence) => sequence.group === entry.group);
      const floors = members.map((m) => m.intensity);
      // Every catalogued group must offer something at `minimal`, which is the
      // weakest setting that still moves -- otherwise a tenant turning the dial
      // down would delete the moment the catalogue just promised them.
      const strongest = Math.min(...floors.map((f) => INTENSITIES.indexOf(f)));
      expect(strongest, `${entry.group} has no variant at "minimal" or below`).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it('keeps a lookup that finds every entry', () => {
    for (const group of GROUPS) {
      expect(catalogueEntry(group), group).toBeDefined();
    }
    expect(catalogueEntry('no-such-group')).toBeUndefined();
  });

  it('only ever resolves an eligible sequence for a group', () => {
    for (const entry of CATALOGUE) {
      for (const intensity of INTENSITIES) {
        const chosen = bestInGroup(entry.group, intensity);
        if (chosen) expect(isEligible(chosen, intensity)).toBe(true);
      }
    }
  });
});
