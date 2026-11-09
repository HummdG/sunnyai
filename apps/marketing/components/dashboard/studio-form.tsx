'use client';

import { useState, type FormEvent } from 'react';

import { api, tenantPath, type TenantView } from '../../lib/portal-api.js';
import { BrandSection, draftFrom, type BrandDraft } from './brand-section.js';
import { LogoPreview } from './logo-preview.js';
import { SunnyPreview } from './sunny-preview.js';
import { errorText, ErrorNote } from './ui.js';

const SWATCHES = [
  { name: 'Orange', value: '#FF7900' },
  { name: 'Purple', value: '#7C4DFF' },
  { name: 'Green', value: '#1E9E5A' },
  { name: 'Blue', value: '#1D6FE0' },
];

/**
 * assistantNameSchema for the browser. The pattern attribute compiles with the
 * `v` flag, where a literal hyphen in a class must be escaped.
 */
const NAME_PATTERN = String.raw`[\p{L}\p{N}][\p{L}\p{N} .'&\-]{0,39}`;
/** The API's own copy for a bad name. */
const NAME_HINT = "Use letters, numbers, spaces and . ' & - only, up to 40 characters.";

/**
 * The greeting with the assistant's new name: only the exact words `I'm <old>`
 * change, so a greeting the installer rewrote is left as they wrote it.
 */

export function renameInGreeting(greeting: string, oldName: string, newName: string): string {
  return greeting.replace(`I'm ${oldName}`, () => `I'm ${newName}`);
}

/**
 * Which part of Studio a form edits: everything (onboarding), the brand (logo
 * and colour), or the assistant's settings (name, greeting, launcher). Each part
 * saves only its own fields.
 */
export type StudioPart = 'all' | 'brand' | 'settings';

/**
 * Sunny Studio: the installer's logo or colour, greeting and launcher position,
 * with the real character (or their own logo) re-theming live beside the form.
 */
export function StudioForm({
  tenant,
  onSaved,
  submitLabel = 'Save',
  part = 'all',
}: {
  tenant: TenantView;
  onSaved: (tenant: TenantView) => void;
  submitLabel?: string;
  part?: StudioPart;
}) {
  const brandPart = part !== 'settings';
  const settingsPart = part !== 'brand';
  const [colour, setColour] = useState(tenant.primaryColor);
  const [greeting, setGreeting] = useState(tenant.greeting);
  const [tagline, setTagline] = useState(tenant.tagline ?? '');
  const [position, setPosition] = useState(tenant.position);
  const [suggestions, setSuggestions] = useState(tenant.suggestions.join('\n'));
  const [brand, setBrand] = useState<BrandDraft>(() => draftFrom(tenant));
  const [assistantName, setAssistantName] = useState(tenant.assistantName);
  // The name the greeting currently says: the last saved or typed one that was not empty.
  const [greetingName, setGreetingName] = useState(tenant.assistantName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function rename(next: string): void {
    setAssistantName(next);
    const trimmed = next.trim();
    if (trimmed === '') return;
    setGreeting((current) => renameInGreeting(current, greetingName, trimmed));
    setGreetingName(trimmed);
  }

  // As the widget shows them: the first six non-empty lines.
  const starters = suggestions
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);

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
            ...(brandPart
              ? {
                  primaryColor: colour,
                  branding: {
                    mode: brand.mode,
                    iconId: brand.icon?.id ?? null,
                    wordmarkId: brand.wordmark?.id ?? null,
                    // Only what the icon can draw, so what is saved is what Studio shows.
                    effects: brand.effects.filter(
                      (effect) => brand.icon?.availableEffects.includes(effect) ?? false,
                    ),
                    colors: brand.colors,
                  },
                }
              : {}),
            ...(settingsPart
              ? {
                  greeting,
                  tagline: tagline.trim() === '' ? null : tagline,
                  position,
                  assistantName: assistantName.trim(),
                  suggestions: starters,
                }
              : {}),
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

  // The preview draws this form's draft, and what the other tab owns as last saved.
  const shownBrand = brandPart ? brand : draftFrom(tenant);
  const shownColour = brandPart ? colour : tenant.primaryColor;
  const shownGreeting = settingsPart ? greeting : tenant.greeting;

  return (
    <div className="studio">
      <form onSubmit={(event) => void submit(event)}>
        {brandPart ? (
          <>
            <BrandSection tenant={tenant} value={brand} onChange={setBrand} />
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
          </>
        ) : null}
        {settingsPart ? (
          <>
            <label className="field">
              <span>Assistant name</span>
              <input
                value={assistantName}
                maxLength={40}
                pattern={NAME_PATTERN}
                title={NAME_HINT}
                required
                onChange={(event) => rename(event.target.value)}
              />
            </label>
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
                Starter buttons <span className="hint">(one per line, up to six)</span>
              </span>
              {/* Read as the field's description, not as part of its name. */}
              <span className="hint" id="starter-buttons-hint" aria-hidden="true">
                Buttons visitors can tap to start a chat. These are what visitors ask Sunny, not
                what Sunny asks them.
              </span>
              <textarea
                value={suggestions}
                aria-describedby="starter-buttons-hint"
                onChange={(e) => setSuggestions(e.target.value)}
              />
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
          </>
        ) : null}
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
      {/* Only the brand form shows the live character: one "Live preview" per page. */}
      <div
        className="preview-stage"
        aria-label={brandPart ? 'Live preview' : 'How your welcome looks'}
      >
        {shownBrand.mode === 'logo' ? (
          <LogoPreview draft={shownBrand} busy={busy} companyName={tenant.companyName} />
        ) : (
          <SunnyPreview colour={shownColour} />
        )}
        <p className="preview-greeting">{shownGreeting}</p>
        {settingsPart && starters.length > 0 ? (
          <ul className="preview-starters" aria-label="Starter buttons">
            {starters.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        ) : null}
        <span className="muted small">Live preview</span>
      </div>
    </div>
  );
}
