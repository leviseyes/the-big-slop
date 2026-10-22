import { config, json } from "@/lib/server";
import { settlePayment } from "@/app/api/studio/route";
export async function POST(req: Request) {
  if (!config.STRIPE_WEBHOOK_SECRET)
    return json({ error: "Webhook not configured" }, 503);
  const raw = await req.text();
  const header = req.headers.get("stripe-signature") || "";
  const parts = header.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
    return json({ error: "Invalid signature" }, 400);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  let verified = false;
  for (const s of signatures) {
    if (!/^[a-f0-9]{64}$/.test(s)) continue;
    const bytes = new Uint8Array(s.match(/../g)!.map((v) => parseInt(v, 16)));
    if (
      await crypto.subtle.verify(
        "HMAC",
        key,
        bytes,
        new TextEncoder().encode(`${timestamp}.${raw}`),
      )
    )
      verified = true;
  }
  if (!verified) return json({ error: "Invalid signature" }, 400);
  try {
    const event = JSON.parse(raw);
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type) &&
      event.data.object.payment_status === "paid"
    )
      await settlePayment(event.data.object);
    return json({ received: true });
  } catch {
    return json({ error: "Payment could not be recorded; retry" }, 500);
  }
}
