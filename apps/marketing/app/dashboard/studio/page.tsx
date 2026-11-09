'use client';

import { PortalShell, usePortal } from '../../../components/dashboard/portal.js';
import { StudioForm } from '../../../components/dashboard/studio-form.js';
import { Card, PageHeader } from '../../../components/dashboard/ui.js';

function Studio() {
  const { tenant, setTenant } = usePortal();
  const canEdit = tenant.role === 'admin' || tenant.role === 'owner';
  return (
    <>
      <PageHeader
        title="Sunny Studio"
        lead="Your colour, your greeting, your questions. The preview is the real Sunny."
      />
      <Card>
        {canEdit ? (
          // Keyed by installer: an unsaved draft never follows the owner to another one.
          <StudioForm key={tenant.id} tenant={tenant} onSaved={setTenant} />
        ) : (
          <p className="muted">Ask an admin to change how Sunny looks.</p>
        )}
      </Card>
    </>
  );
}

export default function StudioPage() {
  return (
    <PortalShell>
      <Studio />
    </PortalShell>
  );
}
