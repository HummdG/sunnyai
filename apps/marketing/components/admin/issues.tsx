'use client';

import Link from 'next/link';

import type { Issue, IssueSeverity } from '../../lib/admin-api.js';

const SEVERITY: Record<IssueSeverity, { label: string; icon: string }> = {
  critical: { label: 'Critical', icon: '!' },
  warning: { label: 'Warning', icon: '▲' },
  info: { label: 'Note', icon: 'i' },
};

const PAGE_HREF: Record<Issue['page'], string> = {
  health: '/admin/health',
  usage: '/admin/usage',
  tenants: '/admin/tenants',
  costs: '/admin/costs',
  errors: '/admin/errors',
};

/**
 * What needs looking at, worst first. Severity is carried by the icon and the
 * word as well as the colour, so it reads the same in greyscale.
 */
export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return (
      <p className="issue-clear">
        <span className="issue-icon sev-ok" aria-hidden="true">
          ✓
        </span>
        Nothing needs attention right now.
      </p>
    );
  }
  return (
    <ul className="issue-list">
      {issues.map((issue) => {
        const severity = SEVERITY[issue.severity];
        const href = issue.tenantId
          ? `/admin/tenants/${encodeURIComponent(issue.tenantId)}`
          : PAGE_HREF[issue.page];
        return (
          <li
            key={`${issue.code}:${issue.tenantId ?? ''}`}
            className={`issue sev-${issue.severity}`}
          >
            <span className={`issue-icon sev-${issue.severity}`} aria-hidden="true">
              {severity.icon}
            </span>
            <div>
              <p className="issue-title">
                <span className="sr-only">{severity.label}: </span>
                <Link href={href}>{issue.title}</Link>
              </p>
              <p className="issue-detail">{issue.detail}</p>
            </div>
            <span className={`issue-tag sev-${issue.severity}`}>{severity.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
