import type { Metadata } from 'next';

import { AcceptInvite } from '../../../../components/auth/accept-invite.js';

export const metadata: Metadata = { title: 'Join your team', robots: { index: false } };

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  return <AcceptInvite token={decodeURIComponent(token)} />;
}
