'use client';

import { useState } from 'react';

import type { FlowEffect, PriceItemView } from '../../../lib/portal-api.js';
import { effectText, needsQuantity, unitsWord, type Context } from './model.js';

/** An answer's price changes, in plain English, and the picker that adds one. */
export function Effects({
  ctx,
  readOnly,
  effects,
  onChange,
}: {
  ctx: Context;
  readOnly: boolean;
  effects: FlowEffect[];
  onChange: (effects: FlowEffect[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="flow-effects">
      {effects.length === 0 ? (
        <p className="muted small">No change to the quote.</p>
      ) : (
        <ul>
          {effects.map((effect, i) => {
            const text = effectText(effect, ctx);
            return (
              <li key={i}>
                {text}
                {readOnly ? null : (
                  <button
                    type="button"
                    className="link-button"
                    aria-label={`Remove price change: ${text}`}
                    onClick={() => onChange(effects.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {readOnly ? null : picking ? (
        <EffectPicker
          items={ctx.items}
          onAdd={(effect) => {
            onChange([...effects, effect]);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button type="button" className="link-button" onClick={() => setPicking(true)}>
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

/** Pick an add, remove or swap from the published price list. */
function EffectPicker({
  items,
  onAdd,
  onCancel,
}: {
  items: PriceItemView[];
  onAdd: (effect: FlowEffect) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<FlowEffect['kind']>('add');
  const [itemKey, setItemKey] = useState('');
  const [fromKey, setFromKey] = useState('');
  const [quantity, setQuantity] = useState('');
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
          Add
        </button>
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
