'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { CopyButton, SkeletonRows } from '../../../components/dashboard/kit.js';
import { PortalShell, usePortal } from '../../../components/dashboard/portal.js';
import { Card, Chip, ErrorNote, errorText, PageHeader } from '../../../components/dashboard/ui.js';
import { api, tenantPath, type Member, type Role } from '../../../lib/portal-api.js';

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including billing',
  admin: 'Settings, knowledge and team',
  sales: 'Inbox and leads, can update lead status',
  viewer: 'Read only',
};

function Team() {
  const { tenant, me } = usePortal();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('sales');
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ email: string; url: string } | null>(null);
  const canManage = tenant.role === 'admin' || tenant.role === 'owner';

  const load = useCallback(() => {
    api<{ members: Member[] }>(tenantPath(tenant.id, '/members'))
      .then(({ members: rows }) => setMembers(rows))
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id]);
  useEffect(load, [load]);

  async function invite(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const result = await api<{ email: string; inviteUrl?: string }>(
        tenantPath(tenant.id, '/members'),
        { body: { email, role } },
      );
      if (result.inviteUrl) setInvited({ email: result.email, url: result.inviteUrl });
      setEmail('');
      load();
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  async function remove(target: string): Promise<void> {
    setError(null);
    try {
      await api(tenantPath(tenant.id, '/members/remove'), { body: { email: target } });
      load();
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  const roles: Role[] =
    tenant.role === 'owner' ? ['owner', 'admin', 'sales', 'viewer'] : ['admin', 'sales', 'viewer'];

  return (
    <>
      <PageHeader
        title="Team"
        lead="Who can see conversations and leads. Colleagues sign in with the email you add."
      />
      <ErrorNote error={error} />
      {canManage ? (
        <Card title="Add a colleague">
          <form onSubmit={(event) => void invite(event)} className="invite-form">
            <label className="field compact">
              <span>Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field compact">
              <span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}: {ROLE_HELP[r]}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <button className="button" type="submit">
                Add colleague
              </button>
            </div>
          </form>
          {invited ? (
            <div className="ok-note" role="status">
              <span className="status-icon" aria-hidden="true">
                ✓
              </span>
              <span>
                {invited.email} can join now. Send them their invitation link, or just tell them to
                sign in with that address.
              </span>
              <CopyButton text={invited.url} label="Copy invitation link" />
            </div>
          ) : null}
        </Card>
      ) : null}
      <Card title="Members">
        {members === null ? (
          <SkeletonRows rows={4} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  {canManage ? (
                    <th scope="col">
                      <span className="muted">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.email}>
                    <td>{member.email}</td>
                    <td>{member.role}</td>
                    <td>
                      {member.joined ? (
                        <Chip tone="ok">Joined</Chip>
                      ) : (
                        <Chip tone="orange">Invited</Chip>
                      )}
                    </td>
                    {canManage ? (
                      <td>
                        {member.email !== me.user.email ? (
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => void remove(member.email)}
                          >
                            Remove
                          </button>
                        ) : (
                          <span className="muted small">You</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export default function TeamPage() {
  return (
    <PortalShell>
      <Team />
    </PortalShell>
  );
}
