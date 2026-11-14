'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api, tenantPath, type LeadRow } from '../../lib/portal-api.js';
import { batteryPaybackText, batteryPriceText, batterySavingsText } from './battery-lead-text.js';
import { heatPumpGrantText, heatPumpSavingsText, money } from './heat-pump-lead-text.js';
import { SkeletonRows } from './kit.js';
import { usePortal } from './portal.js';
import { RoofPhoto } from './roof-photo.js';
import { Card, Chip, formatDate } from './ui.js';

interface QuoteOption {
  id: string;
  label: string;
  isRecommended: boolean;
  headline: string;
  panelCount: number;
  systemKwp: number;
  batteryType: string | null;
  batteryCapacityKwh: number;
  priceGbp: number | null;
  priceIncVatGbp: number | null;
  priceLabel: string;
  lineItems: Array<{ sku: string; label: string; quantity: number; totalGbp: number }>;
  annualGenerationKwh: number;
  annualSavingsGbp: number;
  paybackYears: number | null;
  installerPriced: string[];
  /** The optional Sentinel energy-management uplift, indicative. */
  sentinel?: {
    upliftPercent: number;
    annualSavingsGbp: number;
    paybackYears: number | null;
    addedCostGbp: number | null;
  } | null;
}

interface QuoteBase {
  id: string;
  createdAt: string;
  priced: boolean;
  pricing: { label: string; priceStatus: 'verified' | 'indicative' } | null;
  recommendedId: string | null;
  disclaimer: string;
  leadId: string | null;
  /** The package the visitor chose in the chat, when they chose one. */
  chosenOptionId?: string | null;
}

/** A solar quote; quotes from before quotes came in kinds have no `kind`. */
interface SolarQuote extends QuoteBase {
  kind?: 'solar';
  options: QuoteOption[];
}

interface HeatPumpOption {
  id: string;
  label: string;
  headline: string;
  outputKw: number;
  unitName: string;
  priceGbp: number | null;
  /** The Boiler Upgrade Scheme grant applied (0 when not eligible). */
  grantGbp: number;
  priceAfterGrantGbp: number | null;
  annualSavingsGbp: number;
  installerPriced: boolean;
}

interface HeatPumpQuote extends QuoteBase {
  kind: 'heat_pump';
  options: HeatPumpOption[];
  /** The engine's estimate; only the grant verdict is read here. */
  estimate?: { bus?: { eligible?: boolean | 'unsure' } };
}

interface BatteryOption {
  id: string;
  label: string;
  headline: string;
  capacityKwh: number;
  priceGbp: number | null;
  annualSavingsGbp: number;
  /** The part of the saving from cheap-rate charging (0 off a time-of-use tariff). */
  shiftSavingGbp?: number;
  paybackYears?: number | null;
  installerPriced?: boolean;
  /** What the installer will need to check. */
  warnings?: string[];
}

interface BatteryQuote extends QuoteBase {
  kind: 'battery';
  options: BatteryOption[];
}

type Quote = SolarQuote | HeatPumpQuote | BatteryQuote;

/** The options to show as solar cards: none on a quote of another kind. */
function solarOptionsOf(quote: Quote): QuoteOption[] {
  return quote.kind === undefined || quote.kind === 'solar' ? quote.options : [];
}

/** A battery option on the lead page: its size, price, saving, payback and warnings. */
function BatteryOptionCard({ quote, option }: { quote: BatteryQuote; option: BatteryOption }) {
  const chosen = option.id === quote.chosenOptionId;
  return (
    <article
      className={`quote-option${option.id === quote.recommendedId ? ' recommended' : ''}${chosen ? ' chosen' : ''}`}
      aria-label={chosen ? `${option.label} (chosen by the customer)` : option.label}
    >
      <div className="chip-row">
        {option.id === quote.recommendedId &&
        option.label.trim().toLowerCase() === 'recommended' ? null : (
          <Chip>{option.label}</Chip>
        )}
        {option.id === quote.recommendedId ? <Chip tone="ok">Recommended</Chip> : null}
        {chosen ? <Chip tone="orange">Chosen by the customer</Chip> : null}
      </div>
      <h3>{option.headline}</h3>
      <p className="quote-price">{batteryPriceText(option)}</p>
      <p className="small muted">
        {quote.pricing?.priceStatus === 'verified' ? 'From your price list' : 'Indicative'}, subject
        to a survey
      </p>
      <dl>
        <dt>Battery</dt>
        <dd>{option.capacityKwh.toLocaleString('en-GB')} kWh</dd>
        <dt>Savings</dt>
        <dd>{batterySavingsText(option.annualSavingsGbp, option.shiftSavingGbp ?? 0)}</dd>
        <dt>Payback</dt>
        <dd>{batteryPaybackText({ ...option, paybackYears: option.paybackYears ?? null })}</dd>
      </dl>
      {option.warnings && option.warnings.length > 0 ? (
        <ul className="small muted" aria-label="To check at the survey">
          {option.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/** A heat pump option on the lead page: its output, price and grant. */
function HeatPumpOptionCard({ quote, option }: { quote: HeatPumpQuote; option: HeatPumpOption }) {
  const chosen = option.id === quote.chosenOptionId;
  return (
    <article
      className={`quote-option${option.id === quote.recommendedId ? ' recommended' : ''}${chosen ? ' chosen' : ''}`}
      aria-label={chosen ? `${option.label} (chosen by the customer)` : option.label}
    >
      <div className="chip-row">
        {option.id === quote.recommendedId &&
        option.label.trim().toLowerCase() === 'recommended' ? null : (
          <Chip>{option.label}</Chip>
        )}
        {option.id === quote.recommendedId ? <Chip tone="ok">Recommended</Chip> : null}
        {chosen ? <Chip tone="orange">Chosen by the customer</Chip> : null}
      </div>
      <h3>{option.headline}</h3>
      <p className="quote-price">
        {option.priceGbp === null ? 'Priced at survey' : `About ${money(option.priceGbp)}`}
      </p>
      <p className="small muted">
        {quote.pricing?.priceStatus === 'verified' ? 'From your price list' : 'Indicative'}, subject
        to a survey
      </p>
      <dl>
        <dt>Heat pump</dt>
        <dd>
          {option.outputKw.toLocaleString('en-GB')} kW · {option.unitName}
        </dd>
        <dt>Grant</dt>
        <dd>{heatPumpGrantText(quote.estimate?.bus?.eligible, option.grantGbp)}</dd>
        <dt>After grant</dt>
        <dd>
          {option.priceAfterGrantGbp === null
            ? 'Priced at survey'
            : `About ${money(option.priceAfterGrantGbp)}`}
        </dd>
        <dt>Savings</dt>
        <dd>{heatPumpSavingsText(option.annualSavingsGbp)}</dd>
      </dl>
      {option.installerPriced ? (
        <p className="small muted">
          Part of this option is not on your price list yet, so it is priced at survey.
        </p>
      ) : null}
    </article>
  );
}

interface RoofPlane {
  id: number;
  facing: string;
  pitchDeg: number;
  areaM2: number;
  usableAreaM2: number;
  maxPanels: number;
  suitable: boolean;
}

interface RoofSummary {
  address?: string;
  usableRoofAreaM2?: number;
  estimatedMaxPanels?: number;
  bestFacing?: string;
  reliable?: boolean;
  label?: string;
  roofPlanes?: RoofPlane[];
}

function kwh(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} kWh a year`;
}

/**
 * One lead: contact, consent summary, the quote the visitor saw in the chat
 * and the roof assessment behind it. Every figure is labelled the way the
 * visitor saw it -- indicative unless the installer's price list says verified.
 */
export function LeadDetail({
  lead,
  onClose,
  fullPage = false,
}: {
  lead: LeadRow;
  onClose: () => void;
  /** On its own page, so there is no link to the full lead page. */
  fullPage?: boolean;
}) {
  const { tenant } = usePortal();
  const [quote, setQuote] = useState<Quote | null | undefined>(undefined);
  const [roof, setRoof] = useState<
    { assessment: RoofSummary | null; status: string | null; modelAvailable?: boolean } | undefined
  >(undefined);
  const [proposal, setProposal] = useState(false);
  const base = tenantPath(tenant.id, `/leads/${encodeURIComponent(lead.id)}`);

  useEffect(() => {
    setQuote(undefined);
    setRoof(undefined);
    setProposal(false);
    api<{ quote: (Quote & { proposalAvailable?: boolean }) | null }>(`${base}/quote`)
      .then((body) => {
        setQuote(body.quote);
        if (!body.quote) return;
        if (body.quote.proposalAvailable !== undefined) {
          setProposal(body.quote.proposalAvailable);
          return;
        }
        // Feature-detect the proposal PDF: offered only once the API serves it.
        void fetch(`/api/portal${base}/quote/proposal.pdf`, {
          method: 'HEAD',
          credentials: 'same-origin',
        })
          .then((response) => setProposal(response.ok))
          .catch(() => setProposal(false));
      })
      .catch(() => setQuote(null));
    api<{ assessment: RoofSummary | null; status: string | null; modelAvailable?: boolean }>(
      `${base}/assessment`,
    )
      .then(setRoof)
      .catch(() => setRoof({ assessment: null, status: null }));
  }, [base]);

  return (
    <Card
      title={
        <span className="lead-title">
          {lead.name ?? 'Lead'}
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        </span>
      }
      id="lead-detail"
    >
      <dl className="lead-facts">
        <div>
          <dt>Received</dt>
          <dd>{formatDate(lead.createdAt)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{lead.status}</dd>
        </div>
        <div>
          <dt>Contact</dt>
          <dd>{[lead.email, lead.phone].filter(Boolean).join(' · ') || '–'}</dd>
        </div>
        <div>
          <dt>Postcode</dt>
          <dd>{lead.postcode ?? '–'}</dd>
        </div>
      </dl>
      <p className="lead-summary">{lead.summary}</p>
      {lead.flowAnswers && lead.flowAnswers.length > 0 ? (
        <section aria-labelledby="answers-title" className="lead-section">
          <h3 id="answers-title">Their answers</h3>
          <dl className="lead-facts">
            {lead.flowAnswers.map((entry) => (
              <div key={entry.id}>
                <dt>{entry.question}</dt>
                <dd>{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <div className="actions">
        {lead.conversationId ? (
          <Link className="link-button" href="/dashboard/inbox">
            Read the conversation in the inbox
          </Link>
        ) : null}
        {fullPage ? null : (
          <Link className="link-button" href={`/dashboard/leads/${encodeURIComponent(lead.id)}`}>
            Open the full lead page
          </Link>
        )}
      </div>

      <section aria-labelledby="quote-title" className="lead-section">
        <h3 id="quote-title">Quote shown in the chat</h3>
        {quote === undefined ? (
          <SkeletonRows rows={2} />
        ) : quote === null ? (
          <p className="muted">
            No quote yet. Sunny prices a system once the visitor has answered the questions.
          </p>
        ) : (
          <>
            <p className="small muted">
              {formatDate(quote.createdAt)} ·{' '}
              {quote.pricing
                ? quote.pricing.label
                : 'No price list was published, so Sunny showed sizes and savings without prices.'}
            </p>
            <div className="quote-options">
              {quote.kind === 'heat_pump'
                ? quote.options.map((option) => (
                    <HeatPumpOptionCard key={option.id} quote={quote} option={option} />
                  ))
                : null}
              {quote.kind === 'battery'
                ? quote.options.map((option) => (
                    <BatteryOptionCard key={option.id} quote={quote} option={option} />
                  ))
                : null}
              {solarOptionsOf(quote).map((option) => (
                <article
                  key={option.id}
                  className={`quote-option${option.id === quote.recommendedId ? ' recommended' : ''}${option.id === quote.chosenOptionId ? ' chosen' : ''}`}
                  aria-label={
                    option.id === quote.chosenOptionId
                      ? `${option.label} (chosen by the customer)`
                      : option.label
                  }
                >
                  <div className="chip-row">
                    {/* The recommended option is often labelled "Recommended" already. */}
                    {option.id === quote.recommendedId &&
                    option.label.trim().toLowerCase() === 'recommended' ? null : (
                      <Chip>{option.label}</Chip>
                    )}
                    {option.id === quote.recommendedId ? <Chip tone="ok">Recommended</Chip> : null}
                    {option.id === quote.chosenOptionId ? (
                      <Chip tone="orange">Chosen by the customer</Chip>
                    ) : null}
                  </div>
                  <h3>{option.headline}</h3>
                  <p className="quote-price">
                    {option.priceGbp === null
                      ? 'Priced at survey'
                      : `About ${money(option.priceGbp)}`}
                  </p>
                  <p className="small muted">
                    {quote.pricing?.priceStatus === 'verified'
                      ? 'From your price list'
                      : 'Indicative'}
                    , subject to a survey
                  </p>
                  <dl>
                    <dt>System</dt>
                    <dd>
                      {option.systemKwp.toFixed(1)} kWp · {option.panelCount} panels
                    </dd>
                    <dt>Battery</dt>
                    <dd>
                      {option.batteryType
                        ? `${option.batteryCapacityKwh.toLocaleString('en-GB')} kWh`
                        : 'None'}
                    </dd>
                    <dt>Generation</dt>
                    <dd>{kwh(option.annualGenerationKwh)}</dd>
                    <dt>Savings</dt>
                    <dd>About {money(option.annualSavingsGbp)} a year</dd>
                    <dt>Payback</dt>
                    <dd>
                      {option.paybackYears === null
                        ? '–'
                        : `About ${Math.round(option.paybackYears)} years`}
                    </dd>
                  </dl>
                  {option.sentinel ? (
                    <p className="small muted quote-sentinel">
                      With Sentinel energy management: about +{option.sentinel.upliftPercent}%,
                      saving about {money(option.sentinel.annualSavingsGbp)} a year
                      {option.sentinel.paybackYears !== null
                        ? `, paying back in about ${Math.round(option.sentinel.paybackYears)} years`
                        : ''}
                      {/* A cost under £1 is rounding noise from the uplift maths, not a price. */}
                      {option.sentinel.addedCostGbp !== null && option.sentinel.addedCostGbp >= 1
                        ? ` (adds about ${money(option.sentinel.addedCostGbp)})`
                        : ''}
                      . Indicative.
                    </p>
                  ) : null}
                  {option.lineItems.length > 0 ? (
                    <details>
                      <summary className="small">Line items</summary>
                      <table className="quote-lines">
                        <tbody>
                          {option.lineItems.map((item) => (
                            <tr key={`${item.sku}-${item.label}`}>
                              <td>
                                {item.label}
                                {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                              </td>
                              <td>{money(item.totalGbp)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  ) : null}
                  {option.installerPriced.length > 0 ? (
                    <p className="small muted">
                      Priced at survey: {option.installerPriced.join(', ')}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
            <p className="small muted">{quote.disclaimer}</p>
            {proposal ? (
              <p>
                <a className="button secondary" href={`/api/portal${base}/quote/proposal.pdf`}>
                  Download proposal (PDF)
                </a>
              </p>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="roof-title" className="lead-section">
        <h3 id="roof-title">Roof assessment</h3>
        {roof === undefined ? (
          <SkeletonRows rows={1} />
        ) : roof.assessment === null ? (
          <p className="muted">
            {roof.status
              ? `The assessment is ${roof.status}.`
              : 'No roof assessment for this lead yet.'}
          </p>
        ) : (
          <>
            <p>
              About {Math.round(roof.assessment.usableRoofAreaM2 ?? 0)} m² usable
              {roof.assessment.bestFacing ? `, best facing ${roof.assessment.bestFacing}` : ''},
              with room for up to {roof.assessment.estimatedMaxPanels ?? '–'} panels (estimate).
            </p>
            {roof.assessment.reliable === false ? (
              <p className="warning-note">
                <span className="status-icon" aria-hidden="true">
                  !
                </span>
                Low confidence: confirm the roof on the survey.
              </p>
            ) : null}
            {roof.assessment.roofPlanes && roof.assessment.roofPlanes.length > 0 ? (
              <ul className="chip-row" aria-label="Roof planes">
                {roof.assessment.roofPlanes.map((plane) => (
                  <li key={plane.id}>
                    <Chip tone={plane.suitable ? 'ok' : 'neutral'}>
                      Faces {plane.facing} · {Math.round(plane.pitchDeg)}° ·{' '}
                      {Math.round(plane.usableAreaM2)} m²
                    </Chip>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="small muted">Indicative, subject to an on-site survey.</p>
          </>
        )}
        {/* The 3D model is kept on the server but not shown for now; the photo is. */}
        <RoofPhoto basePath={base} />
      </section>
    </Card>
  );
}
