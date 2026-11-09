'use client';

import { useState } from 'react';

import type { FlowEffect, PriceItemView } from '../../../lib/portal-api.js';
import { effectText, needsQuantity, unitsWord, type Context } from './model.js';

/** "adds 7kW EV charger, £899": an effect's text, as the middle of a sentence. */
function inSentence(effect: FlowEffect, ctx: Context): string {
  const text = effectText(effect, ctx);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * An answer's price changes, in plain English, each with Change and Remove;
 * "Worked out by" when Sunny chose them, Sunny's suggestion for one of its own
 * questions, and the picker that adds one by hand.
 */
export function Effects({
  ctx,
  readOnly,
  effects,
  onChange,
  workedOut = false,
  offer = null,
  onUse,
  onDismiss,
  onPick,
}: {
  ctx: Context;
  readOnly: boolean;
  effects: FlowEffect[];
  onChange: (effects: FlowEffect[]) => void;
  /** Sunny chose these, and the installer has not changed them. */
  workedOut?: boolean;
  /** Sunny's suggestion, offered rather than applied. */
  offer?: FlowEffect[] | null;
  onUse?: (effects: FlowEffect[]) => void;
  onDismiss?: () => void;
  /** The installer opened the picker: from now on the answer is theirs, not Sunny's to fill. */
  onPick?: () => void;
}) {
  // The picker is open to add (`'new'`) or to change the effect at an index.
  const [picking, setPickingState] = useState<'new' | number | null>(null);
  const setPicking = (next: 'new' | number | null) => {
    if (next !== null) onPick?.();
    setPickingState(next);
  };
  return (
    <div className="flow-effects">
      {workedOut ? <p className="flow-worked">Worked out by {ctx.assistant}</p> : null}
      {effects.length === 0 ? (
        <p className="muted small">No price change</p>
      ) : (
        <ul>
          {effects.map((effect, i) => {
            const text = effectText(effect, ctx);
            return picking === i ? (
              <li key={i} className="flow-effect-editing">
                <EffectPicker
                  items={ctx.items}
                  initial={effect}
                  onAdd={(changed) => {
                    onChange(effects.map((e, j) => (j === i ? changed : e)));
                    setPicking(null);
                  }}
                  onCancel={() => setPicking(null)}
                />
              </li>
            ) : (
              <li key={i}>
                {text}
                {readOnly ? null : (
                  <span className="flow-effect-actions">
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`Change price change: ${text}`}
                      onClick={() => setPicking(i)}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`Remove price change: ${text}`}
                      onClick={() => {
                        onChange(effects.filter((_, j) => j !== i));
                        setPicking(null);
                      }}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && offer && offer.length > 0 ? (
        <div className="flow-offer" role="group" aria-label={`${ctx.assistant} suggests`}>
          <p>
            {ctx.assistant} suggests: {offer.map((e) => inSentence(e, ctx)).join('; ')}. Use this?
          </p>
          <div className="actions">
            <button type="button" className="button secondary" onClick={() => onUse?.(offer)}>
              Use
            </button>
            <button type="button" className="link-button" onClick={onDismiss}>
              No thanks
            </button>
          </div>
        </div>
      ) : null}
      {readOnly ? null : picking === 'new' ? (
        <EffectPicker
          items={ctx.items}
          onAdd={(effect) => {
            onChange([...effects, effect]);
            setPicking(null);
          }}
          onCancel={() => setPicking(null)}
        />
      ) : (
        <button type="button" className="link-button" onClick={() => setPicking('new')}>
          + Add a price change
        </button>
      )}
    </div>
  );
}

function ItemOptions({ items }: { items: PriceItemView[] }) {
  return (
    <>
      <option value="">Choose an item</option>
      {items.map((item) => (
        <option key={item.key} value={item.key} disabled={item.mandatory}>
          {item.name}, {item.priceText}
          {item.mandatory ? ' (on every quote, so it cannot change)' : ''}
        </option>
      ))}
    </>
  );
}

/** Pick an add, remove or swap from the published price list, or change one (`initial`). */
function EffectPicker({
  items,
  initial,
  onAdd,
  onCancel,
}: {
  items: PriceItemView[];
  initial?: FlowEffect;
  onAdd: (effect: FlowEffect) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<FlowEffect['kind']>(initial?.kind ?? 'add');
  const [itemKey, setItemKey] = useState(
    !initial ? '' : initial.kind === 'swap' ? initial.toKey : initial.itemKey,
  );
  const [fromKey, setFromKey] = useState(initial?.kind === 'swap' ? initial.fromKey : '');
  const [quantity, setQuantity] = useState(
    initial && initial.kind !== 'remove' && initial.quantity ? String(initial.quantity) : '',
  );
  // Mandatory items are listed (disabled) so the installer sees why they are missing.
  const pickable = items.filter((i) => i.targetable || i.mandatory);

  if (items.length === 0) {
    return (
      <p className="muted small">
        Publish a price list first, on <a href="/dashboard/products/price-list">Price list</a>, to
        link answers to your prices.
      </p>
    );
  }

  const target = items.find((i) => i.key === itemKey);
  const askQuantity = kind !== 'remove' && target !== undefined && needsQuantity(target);
  const amount = Number(quantity);
  const quantityOk = !askQuantity || (Number.isInteger(amount) && amount > 0);
  const ready = itemKey !== '' && (kind !== 'swap' || fromKey !== '') && quantityOk;

  function add(): void {
    const q = askQuantity ? { quantity: amount } : {};
    if (kind === 'add') onAdd({ kind, itemKey, ...q });
    else if (kind === 'remove') onAdd({ kind, itemKey });
    else onAdd({ kind, fromKey, toKey: itemKey, ...q });
  }

  return (
    <div className="flow-picker">
      <label className="field compact">
        <span>What happens</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as FlowEffect['kind'])}>
          <option value="add">Adds an item</option>
          <option value="remove">Removes an item</option>
          <option value="swap">Swaps one item for another</option>
        </select>
      </label>
      {kind === 'swap' ? (
        <label className="field compact">
          <span>Swap out</span>
          <select value={fromKey} onChange={(e) => setFromKey(e.target.value)}>
            <ItemOptions items={pickable} />
          </select>
        </label>
      ) : null}
      <label className="field compact">
        <span>Item from your price list</span>
        <select value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
          <ItemOptions items={pickable} />
        </select>
      </label>
      {askQuantity ? (
        <label className="field compact">
          <span>How many {unitsWord(target.unitLabel)}</span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
      ) : null}
      <div className="actions">
        <button type="button" className="button" disabled={!ready} onClick={add}>
          {initial ? 'Update' : 'Add'}
        </button>
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
