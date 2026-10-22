// Shared by the API and renderer. A saved approval survives later billing-mode changes.
export const paymentsEnabled = (value) => value === "true";

export function hasRenderAuthorization(p) {
  const q = p?.quote,
    c = p?.consent;
  if (
    !q?.id ||
    !Number.isSafeInteger(q.providerCents) ||
    q.providerCents <= 0 ||
    c?.quoteId !== q.id ||
    !Number.isFinite(c.acceptedAt) ||
    c.acceptedAt <= 0
  )
    return false;
  if (p.paidAt && p.checkoutId && c.totalCents === q.totalCents) return true;
  const a = p.generationAuthorization;
  return (
    a?.kind === "owner-funded" &&
    a.quoteId === q.id &&
    a.providerCents === q.providerCents &&
    c.totalCents === q.providerCents &&
    Number.isFinite(a.approvedAt) &&
    a.approvedAt > 0
  );
}
