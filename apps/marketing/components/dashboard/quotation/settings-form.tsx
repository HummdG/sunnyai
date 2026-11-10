'use client';

import { useId, type ReactNode } from 'react';

import { QUOTATION_LIMITS as LIMITS, type TenantView } from '../../../lib/portal-api.js';
import { Accreditations } from './accreditations.js';
import { LogoFields } from './logo-fields.js';
import { problemsOf, readable, type DepositKind, type QuotationDraft } from './model.js';
import { SectionSwitches } from './section-switches.js';

const DEPOSITS: Array<{ kind: DepositKind; title: string }> = [
  { kind: 'percent', title: 'Percentage' },
  { kind: 'fixed', title: 'Fixed amount' },
  { kind: 'none', title: 'None' },
];

const thousands = (n: number) => n.toLocaleString('en-GB');

/** "9 December 2026": today plus the days, as the PDF prints a quote's date. */
function validUntil(days: string): string {
  const n = Number(days.trim());
  const date = new Date();
  if (Number.isInteger(n) && n >= LIMITS.validityMin && n <= LIMITS.validityMax) {
    date.setDate(date.getDate() + n);
  } else {
    date.setDate(date.getDate() + 30);
  }
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** One card in the left column, named by its heading. */
function QuoteCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="quote-card" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {hint ? <p className="hint">{hint}</p> : null}
      {children}
    </section>
  );
}

/** A colour the PDF uses: Your brand's by default, or one the installer picks. */
function ColourChoice({
  label,
  hint,
  use,
  value,
  brand,
  onChange,
}: {
  label: string;
  hint: string;
  use: 'rail' | 'accent';
  value: string | null;
  brand: string;
  onChange: (value: string | null) => void;
}) {
  const used = readable(value ?? brand, use);
  return (
    <fieldset className="quote-colour">
      <legend>{label}</legend>
      <p className="hint">{hint}</p>
      <div className="quote-colour-row">
        <label className="pill quote-colour-brand">
          <input
            type="checkbox"
            checked={value === null}
            onChange={(event) => onChange(event.target.checked ? null : used.hex)}
          />{' '}
          Use my brand colour
        </label>
        <input
          type="color"
          aria-label={`${label} colour`}
          value={(value ?? used.hex).toLowerCase()}
          disabled={value === null}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
        <span className="quote-swatch" style={{ background: used.hex }} aria-hidden="true" />
        <span className="muted small">As printed: {used.hex.toUpperCase()}</span>
      </div>
      {value !== null && used.adjusted ? (
        <p className="small quote-adjusted">Adjusted so text stays readable.</p>
      ) : null}
    </fieldset>
  );
}

/**
 * The left column of "Your quotation": every setting the PDF takes, card by
 * card, as in the approved mockup. The caller's fieldset disables it all for
 * viewers.
 */
export function SettingsForm({
  tenant,
  assistant,
  draft,
  onEdit,
}: {
  tenant: TenantView;
  assistant: string;
  draft: QuotationDraft;
  onEdit: (change: (current: QuotationDraft) => QuotationDraft) => void;
}) {
  const problems = problemsOf(draft);
  const ids = useId();
  const set = <K extends keyof QuotationDraft>(key: K, value: QuotationDraft[K]) =>
    onEdit((d) => ({ ...d, [key]: value }));
  const setSigner = (key: keyof QuotationDraft['signer'], value: string) =>
    onEdit((d) => ({ ...d, signer: { ...d.signer, [key]: value } }));

  return (
    <div className="quote-settings">
      <QuoteCard title="Logo">
        <LogoFields tenant={tenant} logo={draft.logo} onChange={(logo) => set('logo', logo)} />
      </QuoteCard>

      <QuoteCard
        title="Signed by"
        hint="The person the letter is from. Left blank, it is signed with your company name and contact details."
      >
        <div className="field-row">
          {(
            [
              ['name', 'Name', 'text', 'name'],
              ['role', 'Role', 'text', 'organization-title'],
              ['phone', 'Phone', 'tel', 'tel'],
              ['email', 'Email', 'email', 'email'],
            ] as const
          ).map(([key, title, type, auto]) => (
            <label key={key} className="field">
              <span>{title}</span>
              <input
                type={type}
                autoComplete={auto}
                value={draft.signer[key]}
                maxLength={LIMITS.line}
                onChange={(event) => setSigner(key, event.target.value)}
              />
            </label>
          ))}
        </div>
      </QuoteCard>

      <QuoteCard title="Accreditations">
        <Accreditations
          tenantId={tenant.id}
          mcsNumber={draft.mcsNumber}
          logos={draft.accreditations}
          onMcsNumber={(value) => set('mcsNumber', value)}
          onLogos={(change) => onEdit((d) => ({ ...d, accreditations: change(d.accreditations) }))}
        />
      </QuoteCard>

      <QuoteCard
        title="What the PDF includes"
        hint="Turn off any part your customers don't need. The quotation itself always shows, with its estimate wording."
      >
        <SectionSwitches
          sections={draft.sections}
          termsBlank={draft.terms.trim() === ''}
          onChange={(key, on) => onEdit((d) => ({ ...d, sections: { ...d.sections, [key]: on } }))}
        />
      </QuoteCard>

      <QuoteCard title="Deposit and validity">
        <div className="field-row quote-deposit">
          <div className="field">
            <span id={`${ids}-deposit`}>Deposit</span>
            <div className="flow-seg" role="group" aria-labelledby={`${ids}-deposit`}>
              {DEPOSITS.map((d) => (
                <button
                  key={d.kind}
                  type="button"
                  aria-pressed={draft.depositKind === d.kind}
                  onClick={() => set('depositKind', d.kind)}
                >
                  {d.title}
                </button>
              ))}
            </div>
            {draft.depositKind === 'percent' ? (
              <label className="quote-unit">
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label="Deposit percentage"
                  min={LIMITS.percentMin}
                  max={LIMITS.percentMax}
                  step={1}
                  value={draft.percent}
                  aria-invalid={problems.percent ? true : undefined}
                  onChange={(event) => set('percent', event.target.value)}
                />
                <span aria-hidden="true">% of the estimated total</span>
              </label>
            ) : draft.depositKind === 'fixed' ? (
              <label className="quote-unit">
                <span aria-hidden="true">£</span>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label="Deposit amount in pounds"
                  min={LIMITS.fixedMin}
                  max={LIMITS.fixedMax}
                  step={1}
                  value={draft.amount}
                  aria-invalid={problems.amount ? true : undefined}
                  onChange={(event) => set('amount', event.target.value)}
                />
              </label>
            ) : (
              <span className="hint">No deposit block in the PDF.</span>
            )}
            {problems.percent || problems.amount ? (
              <span className="quote-problem" role="alert">
                {problems.percent ?? problems.amount}
              </span>
            ) : draft.depositKind === 'none' ? null : (
              <span className="hint">Payable once the survey has confirmed the final price.</span>
            )}
          </div>
          <div className="field">
            <label className="field compact">
              <span>Quote valid for (days)</span>
              <input
                type="number"
                inputMode="numeric"
                min={LIMITS.validityMin}
                max={LIMITS.validityMax}
                step={1}
                value={draft.validity}
                aria-invalid={problems.validity ? true : undefined}
                onChange={(event) => set('validity', event.target.value)}
              />
            </label>
            {problems.validity ? (
              <span className="quote-problem" role="alert">
                {problems.validity}
              </span>
            ) : (
              <span className="hint">
                Shown as a date, for example &quot;Valid until {validUntil(draft.validity)}&quot;.
              </span>
            )}
          </div>
        </div>
        <label className="field compact">
          <span>Balance due</span>
          <input
            value={draft.balanceDue}
            maxLength={LIMITS.line}
            placeholder="within 7 days of completion"
            onChange={(event) => set('balanceDue', event.target.value)}
          />
        </label>
      </QuoteCard>

      <QuoteCard
        title="Colours"
        hint="Your brand colour by default. A colour you choose is darkened if it needs to be, so text on it stays readable."
      >
        <ColourChoice
          label="Side panel"
          hint="The dark panel down the cover and the quotation."
          use="rail"
          value={draft.rail}
          brand={tenant.primaryColor}
          onChange={(value) => set('rail', value)}
        />
        <ColourChoice
          label="Highlight"
          hint="The panels on the roof plan, the reasons beside each item and the headline."
          use="accent"
          value={draft.accent}
          brand={tenant.primaryColor}
          onChange={(value) => set('accent', value)}
        />
      </QuoteCard>

      <QuoteCard
        title="Letter"
        hint={`The letter's own sentences stay, and say the figures are estimates until the survey. Your lines open and close it. ${assistant} never writes it for you.`}
      >
        <label className="field">
          <span>Opening line</span>
          <input
            value={draft.opening}
            maxLength={LIMITS.line}
            placeholder="Thank you for asking us to quote for your home."
            onChange={(event) => set('opening', event.target.value)}
          />
        </label>
        <label className="field compact">
          <span>Closing line</span>
          <input
            value={draft.closing}
            maxLength={LIMITS.line}
            placeholder="We look forward to hearing from you."
            onChange={(event) => set('closing', event.target.value)}
          />
        </label>
      </QuoteCard>

      <QuoteCard
        title="Your terms and conditions"
        hint="Paste them as they are. Headings and paragraphs are kept: a blank line starts a new paragraph, and a short line in capitals is a heading."
      >
        <label className="field compact">
          <span className="sr-only">Terms and conditions text</span>
          <textarea
            className="quote-terms"
            value={draft.terms}
            maxLength={LIMITS.terms}
            aria-describedby={`${ids}-terms-count`}
            onChange={(event) => {
              const terms = event.target.value;
              onEdit((d) => ({
                ...d,
                terms,
                // Pasted into an empty box: the Terms page comes on with it.
                sections:
                  d.terms.trim() === '' && terms.trim() !== '' && !d.sections.terms
                    ? { ...d.sections, terms: true }
                    : d.sections,
              }));
            }}
          />
        </label>
        <p className="muted small quote-count" id={`${ids}-terms-count`}>
          {thousands(draft.terms.length)} of {thousands(LIMITS.terms)} characters
        </p>
      </QuoteCard>
    </div>
  );
}
