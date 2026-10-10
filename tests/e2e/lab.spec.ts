import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { CATALOGUE, UNWIRED_GROUPS } from '@sunny/animation-engine';
import { ticTacToe } from '@sunny/games';

/**
 * The animation catalogue, in a browser.
 *
 * The engine's own catalogue test proves each moment *would* be drawn, by
 * asking the scheduler. This proves it is drawn: the lab's `Play` button is the
 * only surface where a person can ask for a moment the way a stream event does
 * and watch the answer, and a card lights up only while its moment is the one
 * the scheduler drew. So "the catalogue and playable tests pass" is a claim
 * about something that was clicked rather than about something that was read.
 *
 * The lab is served on its own port by the `webServer` entry in
 * `playwright.config.ts`, rather than through `baseURL`, because it is a
 * developer surface rather than a host fixture.
 */

const LAB_URL = `http://localhost:${Number(process.env.LAB_PORT ?? 4180)}`;

const card = (group: string) => `#catalogue-card .moment[data-group="${group}"]`;

test('lists every catalogued moment, and only those', async ({ page }) => {
  await page.goto(LAB_URL);

  await expect(page.locator('#catalogue-card .moment')).toHaveCount(CATALOGUE.length);

  for (const entry of CATALOGUE) {
    const moment = page.locator(card(entry.group));
    await expect(moment, `${entry.group} is missing from the gallery`).toHaveCount(1);
    // The name on the page and the name in the catalogue are the same string,
    // so a moment cannot be renamed in one place and not the other.
    await expect(moment.locator('.moment-name')).toHaveText(entry.name);
    await expect(moment.locator('.moment-desc')).toHaveText(entry.description);
  }
});

test('marks the moments nothing asks for, rather than hiding them', async ({ page }) => {
  await page.goto(LAB_URL);

  // A moment with no caller of any kind -- neither an engine event nor a gesture
  // the host forwards -- is implemented and tested and cannot be reached in
  // production. Hiding it would let that stay true unremarked; the gallery shows
  // it dashed, with the reason underneath.
  //
  // The count is of the *unwired* moments, which is a different list from the
  // unreachable ones: a gesture moment like the balloon is also unwired here,
  // because the widget does not forward a pointer yet, but it is not unreachable
  // in the sense the catalogue means -- something outside the engine asks for it.
  await expect(page.locator('#catalogue-card .moment.unwired')).toHaveCount(UNWIRED_GROUPS.length);
  for (const group of UNWIRED_GROUPS) {
    await expect(page.locator(card(group))).toHaveClass(/unwired/);
    await expect(page.locator(`${card(group)} .moment-why`)).not.toBeEmpty();
  }
});

test('plays every moment in the catalogue when it is asked for', async ({ page }) => {
  await page.goto(LAB_URL);

  for (const entry of CATALOGUE) {
    const moment = page.locator(card(entry.group));
    const play = moment.getByRole('button');
    await expect(play, `${entry.group} has no playable variant`).toBeEnabled();
    await play.click();

    // Asserted on the mark the page leaves for what it drew, not on the live
    // highlight. Several moments are on screen only briefly -- the listening
    // perk waits behind the 420 ms bubble the same event requests and is then
    // drawn for under a third of a second -- so sampling the class could miss a
    // moment that plays perfectly well and report it as broken. The generous
    // timeout is for the same reason: "eventually drawn" is the honest claim,
    // not "drawn on the next frame".
    await expect(moment, `"${entry.group}" was asked for and never drawn`).toHaveAttribute(
      'data-drawn',
      '1',
      { timeout: 10_000 },
    );
  }
});

/**
 * A05 in a browser: the one moment a visitor starts by hand.
 *
 * The engine tests prove `tap()` hit-tests the right thing at the right
 * coordinate. What only a browser can show is that the gesture *arrives* -- that
 * a pointer at a screen position becomes the viewBox coordinate the engine
 * reasons in, through the transform the browser actually applied and not one
 * this test re-derived. `stagePoint` converts with the same screen matrix the
 * lab does, so a lab whose conversion broke would fail here rather than only in
 * the eye.
 */
async function stagePoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  // `#stage > svg` and not `#stage svg`: the stage's own `<svg>` holds the frame
  // the renderer produced, which is *another* `<svg>`. The lab reads the outer
  // one's screen matrix, so the test has to read the same one -- and it is the
  // same mapping either way, because the inner svg is laid out to fill exactly
  // the outer viewport.
  return page.locator('#stage > svg').evaluate(
    (node, viewBox) => {
      const ctm = (node as SVGSVGElement).getScreenCTM();
      if (!ctm) throw new Error('the stage svg has no screen ctm');
      const p = new DOMPoint(viewBox.x, viewBox.y).matrixTransform(ctm);
      return { x: p.x, y: p.y };
    },
    { x, y },
  );
}

test('gives her a balloon on a tap, and pops it on a second one', async ({ page }) => {
  await page.goto(LAB_URL);
  const balloon = page.locator('#stage [data-prop="balloon"]');
  const log = page.locator('#scrubber .event-log');
  await expect(balloon).toHaveCount(0);

  // A tap on the body. The body centre is the viewBox centre, which is the one
  // point on the stage that needs no arithmetic to locate.
  const body = await stagePoint(page, 100, 100);
  await page.mouse.click(body.x, body.y);
  await expect(balloon).toHaveCount(1);

  // Let it finish rising. The float eases into place over the first fifth of its
  // loop, so reading its position before then would read a balloon in flight.
  await page.waitForTimeout(2_000);

  // Tap the balloon where it is painted, rather than at a coordinate this test
  // worked out: the hit test is against the drawing, so the click should be too.
  //
  // The query and the rectangle are read in one page-side call, and not through
  // an element handle. The lab replaces the stage's markup on every animation
  // frame, so a handle obtained a moment ago is already detached and reports a
  // zero rectangle -- `boundingBox()` returns null for the same reason.
  const box = await page.evaluate(() => {
    const node = document.querySelector('#stage [data-prop="balloon"]');
    if (!node) return null;
    const rect = (node as SVGGraphicsElement).getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  expect(box?.width ?? 0, 'the balloon is drawn but has no size on screen').toBeGreaterThan(0);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // The float is gone rather than drawn underneath its own shards. The log entry
  // is what makes this a claim about the pop rather than merely about absence:
  // it records what the tap produced, and outlives the burst itself.
  await expect(balloon).toHaveCount(0);
  await expect(log).toContainText('→ pop');
});

test('does nothing at all when the empty stage is tapped', async ({ page }) => {
  await page.goto(LAB_URL);

  // A corner of the viewBox: outside the silhouette and outside every ray, so
  // the one gesture a visitor can make by accident is a no-op.
  const corner = await stagePoint(page, 12, 12);
  await page.mouse.click(corner.x, corner.y);

  await expect(page.locator('#scrubber .event-log')).toContainText('nothing there');
});

/**
 * A06, played rather than asserted.
 *
 * The rules are proved in `packages/games`; what can only be proved here is that
 * the board a visitor sees is *that* game -- that a click lands on the square it
 * was aimed at, that Sunny answers on her own turn and not before, and that the
 * history the page publishes rebuilds the position it is showing.
 */

const boardStatus = '#game .game-status';
const cellAt = (cell: number) => `#game .cell[data-cell="${cell}"]`;

/**
 * Click the lowest-numbered square the visitor is allowed to play.
 *
 * Page-side rather than through a locator because the board is redrawn as marks
 * land: a locator resolved a moment ago may name a square that is no longer
 * playable, and the arithmetic of which square is free is the game's, not this
 * test's.
 */
async function playLowestFreeSquare(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll<HTMLButtonElement>('#game .cell'));
    const free = cells.find((cell) => !cell.disabled && cell.dataset.square === 'empty');
    if (!free) return false;
    free.click();
    return true;
  });
}

/** Wait until it is the visitor's turn again, or the game is over. */
async function waitForTheBoard(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const outcome =
            document.querySelector<HTMLElement>('#game .game-status')?.dataset.outcome;
          if (outcome !== 'playing') return true;
          return Array.from(document.querySelectorAll<HTMLButtonElement>('#game .cell')).some(
            (cell) => !cell.disabled && cell.dataset.square === 'empty',
          );
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
}

test('gives the visitor a real board, and takes a turn of her own', async ({ page }) => {
  await page.goto(LAB_URL);

  const cells = page.locator('#game .cell');
  await expect(cells).toHaveCount(9);
  await expect(page.locator('#game .cell[data-square="empty"]')).toHaveCount(9);
  await expect(page.locator(boardStatus)).toHaveText(/Your turn/);

  // The centre: her first answer is forced by the rules whatever the tie-break
  // does, because a board with one X on it has no line to take or to block.
  await page.locator(cellAt(4)).click();
  await expect(page.locator(cellAt(4))).toHaveText('X');

  // A square cannot be played twice: the mark is on the board and the square is
  // no longer a target.
  await expect(page.locator(cellAt(4))).toBeDisabled();

  // Her turn is visible while it lasts. The label is the stage's own record of
  // which sequence it drew, so this is a claim about the character rather than
  // about a class the board put on a paragraph.
  await expect(page.locator('#stage .stage-label')).toContainText('thinking-');

  await expect(page.locator('#game .cell[data-square="O"]')).toHaveCount(1);
  await expect(page.locator(cellAt(4))).toHaveText('X');
  await expect(page.locator(boardStatus)).toHaveText(/Your turn/);
  await expect(page.locator(boardStatus)).toHaveAttribute('data-outcome', 'playing');
});

test('plays a game to its end, and the history rebuilds the board', async ({ page }) => {
  await page.goto(LAB_URL);
  await waitForTheBoard(page);

  // Five moves is the most X can ever make, so this either finishes the game or
  // runs out of moves, and both are the end of it.
  for (let i = 0; i < 5; i++) {
    if (!(await playLowestFreeSquare(page))) break;
    await waitForTheBoard(page);
    if ((await page.locator(boardStatus).getAttribute('data-outcome')) !== 'playing') break;
  }

  const ended = await page.locator(boardStatus).getAttribute('data-outcome');
  expect(['X', 'O', 'drawn'], 'the game reached no conclusion').toContain(ended);

  // The replay, checked rather than described: the log the page published is run
  // back through the same rules, and the position it produces is compared with
  // the marks actually on screen.
  const drawn = await page.evaluate(() => ({
    moves: document
      .querySelector<HTMLElement>('#game .game-log')!
      .dataset.moves!.split(',')
      .filter((m) => m !== '')
      .map(Number),
    squares: Array.from(document.querySelectorAll<HTMLButtonElement>('#game .cell')).map(
      (cell) => cell.dataset.square,
    ),
  }));

  const rebuilt = ticTacToe.replay(drawn.moves).squares.map((square) => square ?? 'empty');
  expect(rebuilt, 'the published history does not rebuild the board on screen').toEqual(
    drawn.squares,
  );
  expect(drawn.moves.length).toBeGreaterThan(0);

  // And a game can be started again: a fresh board, nobody to move but the
  // visitor.
  await page.locator('#game .btn', { hasText: 'New game' }).click();
  await expect(page.locator('#game .cell[data-square="empty"]')).toHaveCount(9);
  await expect(page.locator(boardStatus)).toHaveText(/Your turn/);
});

/**
 * A08, played rather than asserted.
 *
 * A08's fourth word is *lazy-loaded*, and that is a claim about bytes: the rules
 * are proved in `packages/games`, but "the game is not in the page until it is
 * asked for" can only be proved by watching the network. So the first test
 * listens to requests and the second one drives the cabinet.
 */

/**
 * The element the arcade was mounted into, and the element it writes its
 * readouts to.
 *
 * `#arcade` is the lab's section; the game is mounted into the slot inside it,
 * and the `data-*` the readouts are published as belong to whatever `mount` was
 * handed rather than to the section that happens to contain it.
 */
const arcadeSlot = '#arcade .arcade-slot';
const arcadeField = '#arcade .arcade-field';
const loadTheArcade = (page: Page) =>
  page.locator('#arcade .btn', { hasText: 'Load the arcade' }).click();

const arcadeRead = (page: Page, key: string): Promise<string | null> =>
  page.locator(arcadeSlot).getAttribute(`data-${key}`);

/**
 * Aim at the middle of the fleet's lowest rank, then fire -- in one page-side
 * turn.
 *
 * Read from the cells rather than assumed, because the aim is the whole of the
 * game's skill and a test that fired from wherever the ship happened to be would
 * be testing the fleet's luck. The *middle* of the rank rather than its edge,
 * because the fleet steps sideways while the shot is in the air: a column three
 * cells in still has an invader over it after the fleet has moved one.
 *
 * Both clicks go through the page rather than through Playwright, and that is
 * the difference between this passing and failing. A locator click is a round
 * trip; the fleet keeps stepping during it, and by the time a driver-aimed shot
 * reached the fleet it had moved to the other side of the field -- which is a
 * fact about the harness rather than about the game. A player aims and fires in
 * one movement, and so does this.
 */
const aimAndFire = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll<HTMLElement>('#arcade .arcade-cell'));
    const fleet = cells
      .filter((cell) => cell.dataset.occupant === 'invader')
      .map((cell) => (cell.dataset.cell ?? '0,0').split(',').map(Number) as [number, number]);
    const lowest = Math.max(...fleet.map(([, y]) => y));
    const columns = fleet
      .filter(([, y]) => y === lowest)
      .map(([x]) => x)
      .sort((a, b) => a - b);
    const target = columns[Math.floor(columns.length / 2)]!;

    const ship = cells.find((cell) => cell.dataset.occupant === 'ship')!;
    const shipX = Number((ship.dataset.cell ?? '0,0').split(',')[0]);
    const way = target > shipX ? 'right' : 'left';
    const move = document.querySelector<HTMLButtonElement>(`#arcade .btn[data-key="${way}"]`)!;
    for (let i = 0; i < Math.abs(target - shipX); i++) move.click();
    document.querySelector<HTMLButtonElement>('#arcade .btn[data-key="fire"]')!.click();
  });

test('fetches the arcade only when it is asked for', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/arcade.js')) asked.push(request.url());
  });

  await page.goto(LAB_URL);

  // The page is up and doing its work -- the catalogue is drawn from the same
  // bundle -- and the arcade has still not been asked for. That ordering is the
  // claim: not "the arcade is absent" but "nothing fetched it".
  await expect(page.locator('#catalogue-card .moment')).toHaveCount(CATALOGUE.length);
  await expect(page.locator(arcadeSlot)).toBeEmpty();
  expect(asked, 'the arcade bundle was fetched before anyone asked for it').toEqual([]);

  await loadTheArcade(page);

  await expect(page.locator(arcadeField)).toBeVisible();
  await expect(page.locator(`${arcadeField} .arcade-cell`)).toHaveCount(12 * 12);
  // Where the rules say they are, counted from the rules: four ranks of six.
  await expect(page.locator(arcadeSlot)).toHaveAttribute('data-invaders', '24');
  await expect(page.locator(arcadeSlot)).toHaveAttribute('data-lives', '3');
  expect(asked, 'the arcade never asked for its own bundle').not.toEqual([]);

  // The button goes away rather than becoming a second way to mount a second
  // game into the same slot.
  await expect(page.locator('#arcade .btn', { hasText: 'Load the arcade' })).toHaveCount(0);
});

test('drives the arcade from the keyboard, and the score answers a hit', async ({ page }) => {
  await page.goto(LAB_URL);
  await loadTheArcade(page);

  const ship = page.locator(`${arcadeField} .arcade-cell[data-occupant="ship"]`);
  const shipAt = () => ship.getAttribute('data-cell');
  // A shot or a bomb in the ship's cell is drawn over it, so wait for a frame
  // where the ship is the thing in its own cell before reading where it is.
  await expect(ship).toHaveCount(1);

  // The keys belong to the panel, not to the document: a visitor reading the
  // catalogue is not playing the game, and the panel says where the keys go.
  const adrift = (await shipAt())!;
  await page.keyboard.press('ArrowLeft');
  await expect(ship).toHaveAttribute('data-cell', adrift);

  await page.locator(arcadeField).focus();
  const before = await shipAt();
  await page.keyboard.press('ArrowLeft');
  await expect(ship).not.toHaveAttribute('data-cell', before!);
  await page.keyboard.press('ArrowRight');
  await expect(ship).toHaveAttribute('data-cell', before!);

  // A hit is the claim, and the game's own clock is what makes it awkward to
  // arrange: the shot takes six ticks to cross the empty field and the fleet is
  // stepping under it the whole way. So the test aims at where the fleet is and
  // tries again if it slipped aside, which is what a player does.
  let hit = false;
  for (let attempt = 0; attempt < 6 && !hit; attempt++) {
    // One shot in the air at a time, as the cabinet had it, so an attempt waits
    // for the last one to land or leave before taking its own -- otherwise it
    // would press Fire into a no-op.
    await expect(page.locator(`${arcadeField} .arcade-cell[data-occupant="shot"]`)).toHaveCount(0);
    // A game cut short by the bombs is not a failure of the aim: start again and
    // carry on, which is the only thing the cabinet ever offered either.
    if ((await arcadeRead(page, 'status')) === 'lost') {
      await page.locator('#arcade .btn[data-key="restart"]').click();
    }
    await aimAndFire(page);
    hit = await page
      .waitForFunction(
        () =>
          (document.querySelector<HTMLElement>('#arcade .arcade-slot')?.dataset.score ?? '0') !==
          '0',
        undefined,
        { timeout: 2_000 },
      )
      .then(
        () => true,
        () => false,
      );
  }
  expect(hit, 'no shot ever hit an invader').toBe(true);

  // The score moved and the fleet shrank by exactly what a kill takes.
  expect(Number(await arcadeRead(page, 'invaders'))).toBeLessThan(24);
  expect(Number(await arcadeRead(page, 'score'))).toBeGreaterThan(0);

  // Restart keeps nothing: not the score, not the fleet.
  await page.locator('#arcade .btn[data-key="restart"]').click();
  await expect(page.locator(arcadeSlot)).toHaveAttribute('data-score', '0');
  await expect(page.locator(arcadeSlot)).toHaveAttribute('data-wave', '1');
  await expect(page.locator(arcadeSlot)).toHaveAttribute('data-invaders', '24');
  await expect(page.locator(arcadeSlot)).toHaveAttribute('data-status', 'playing');
  await expect(page.locator(`${arcadeField} .arcade-cell[data-occupant="ship"]`)).toHaveCount(1);
});
