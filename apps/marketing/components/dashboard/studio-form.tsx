'use client';

import { useState, type FormEvent } from 'react';

import { api, tenantPath, type TenantView } from '../../lib/portal-api.js';
import { SunnyPreview } from './sunny-preview.js';
import { errorText, ErrorNote } from './ui.js';

const SWATCHES = [
  { name: 'Orange', value: '#FF7900' },
  { name: 'Purple', value: '#7C4DFF' },
  { name: 'Green', value: '#1E9E5A' },
  { name: 'Blue', value: '#1D6FE0' },
];

/**
 * Sunny Studio: the installer's colour, greeting and launcher position, with
 * the real character re-theming live beside the form.
 */
export function StudioForm({
  tenant,
  onSaved,
  submitLabel = 'Save',
}: {
  tenant: TenantView;
  onSaved: (tenant: TenantView) => void;
  submitLabel?: string;
}) {
  const [colour, setColour] = useState(tenant.primaryColor);
  const [greeting, setGreeting] = useState(tenant.greeting);
  const [tagline, setTagline] = useState(tenant.tagline ?? '');
  const [position, setPosition] = useState(tenant.position);
  const [suggestions, setSuggestions] = useState(tenant.suggestions.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { tenant: next } = await api<{ tenant: TenantView }>(
        tenantPath(tenant.id, '/settings'),
        {
          body: {
            primaryColor: colour,
            greeting,
            tagline: tagline.trim() === '' ? null : tagline,
            position,
            suggestions: suggestions
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .slice(0, 6),
          },
        },
      );
      setSaved(true);
      onSaved(next);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio">
      <form onSubmit={(event) => void submit(event)}>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
          <legend style={{ fontWeight: 650, marginBottom: 8 }}>Colour</legend>
          <div className="pills" role="group" aria-label="Brand colour">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                className="pill"
                aria-pressed={colour.toUpperCase() === swatch.value}
                onClick={() => setColour(swatch.value)}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    background: swatch.value,
                    marginRight: 6,
                  }}
                />
                {swatch.name}
              </button>
            ))}
            <label
              className="pill"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              Custom
              <input
                type="color"
                value={colour}
                onChange={(event) => setColour(event.target.value.toUpperCase())}
                aria-label="Custom colour"
                style={{ width: 28, height: 22, border: 0, padding: 0, background: 'none' }}
              />
            </label>
          </div>
        </fieldset>
        <label className="field">
          <span>Greeting</span>
          <textarea
            value={greeting}
            maxLength={300}
            required
            onChange={(e) => setGreeting(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Tagline under your name</span>
          <input value={tagline} maxLength={200} onChange={(e) => setTagline(e.target.value)} />
        </label>
        <label className="field">
          <span>
            Suggested questions <span className="hint">(one per line, up to six)</span>
          </span>
          <textarea value={suggestions} onChange={(e) => setSuggestions(e.target.value)} />
        </label>
        <label className="field">
          <span>Launcher position</span>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as TenantView['position'])}
          >
            <option value="bottom-right">Bottom right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="top-right">Top right</option>
            <option value="top-left">Top left</option>
          </select>
        </label>
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {saved ? (
          <p className="ok-note" role="status">
            Saved. Your widget picks this up on its next load.
          </p>
        ) : null}
        <ErrorNote error={error} />
      </form>
      <div className="preview-stage" aria-label="Live preview">
        <SunnyPreview colour={colour} />
        <p className="preview-greeting">{greeting}</p>
        <span className="muted small">Live preview</span>
      </div>
    </div>
  );
}
