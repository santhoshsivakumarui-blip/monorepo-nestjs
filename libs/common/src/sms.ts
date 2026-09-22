export interface SmsMessage {
  to: string;
  message: string;
}

interface Msg91FlowResponse {
  type?: string;
  message?: string;
}

/**
 * Sends an SMS via MSG91's Flow API. The DLT-approved template must expose a
 * single free-text variable (name configurable via MSG91_TEMPLATE_VAR,
 * default "VAR1") that carries the message body.
 */
export async function sendSms({ to, message }: SmsMessage) {
  const authkey = process.env.MSG91_AUTHKEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;
  const sender = process.env.MSG91_SENDER_ID;
  if (!authkey || !templateId || !sender) {
    throw new Error(
      "MSG91_AUTHKEY, MSG91_TEMPLATE_ID and MSG91_SENDER_ID must be configured",
    );
  }
  const variable = process.env.MSG91_TEMPLATE_VAR ?? "VAR1";

  const response = await fetch("https://control.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: {
      authkey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      template_id: templateId,
      sender,
      short_url: "0",
      recipients: [{ mobiles: to, [variable]: message }],
    }),
  });

  const body = (await response.json().catch(() => undefined)) as
    | Msg91FlowResponse
    | undefined;

  if (!response.ok || body?.type === "error") {
    throw new Error(`MSG91 send failed: ${body?.message ?? response.statusText}`);
  }

  return body;
}
