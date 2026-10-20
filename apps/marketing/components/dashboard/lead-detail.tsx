'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api, tenantPath, type LeadRow } from '../../lib/portal-api.js';
import { SkeletonRows } from './kit.js';
import { usePortal } from './portal.js';
import { RoofViewer3D } from './roof-viewer.js';
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

interface Quote {
  id: string;
  createdAt: string;
  priced: boolean;
  pricing: { label: string; priceStatus: 'verified' | 'indicative' } | null;
  options: QuoteOption[];
  recommendedId: string | null;
  disclaimer: string;
  leadId: string | null;
  /** The package the visitor chose in the chat, when they chose one. */
  chosenOptionId?: string | null;
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

/** Money per guidelines H3: £6,500 (pence only under £100). */
function money(gbp: number): string {
  return gbp < 100 ? `£${gbp.toFixed(2)}` : `£${Math.round(gbp).toLocaleString('en-GB')}`;
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
  /** On its own page the 3D view is shown open; inline it waits to be asked for. */
  fullPage?: boolean;
}) {
  const { tenant } = usePortal();
  const [quote, setQuote] = useState<Quote | null | undefined>(undefined);
  const [roof, setRoof] = useState<
    { assessment: RoofSummary | null; status: string | null; modelAvailable?: boolean } | undefined
  >(undefined);
  const [proposal, setProposal] = useState(false);
  const [show3d, setShow3d] = useState(fullPage);
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
              {quote.options.map((option) => (
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
                      ? 'Priced by your team'
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
                      For your team to price: {option.installerPriced.join(', ')}
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
            {/* The 3D view lists the same planes, interactively; one list is enough. */}
            {!(show3d && roof.modelAvailable) &&
            roof.assessment.roofPlanes &&
            roof.assessment.roofPlanes.length > 0 ? (
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
            {roof.modelAvailable ? (
              show3d ? (
                <RoofViewer3D
                  basePath={`${base}/assessment`}
                  address={roof.assessment.address ?? lead.postcode}
                  planes={roof.assessment.roofPlanes ?? []}
                  reliable={roof.assessment.reliable !== false}
                />
              ) : (
                <button type="button" className="button secondary" onClick={() => setShow3d(true)}>
                  See the roof in 3D
                </button>
              )
            ) : null}
          </>
        )}
      </section>
    </Card>
  );
}
