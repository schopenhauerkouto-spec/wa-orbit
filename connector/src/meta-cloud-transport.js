export class MetaCloudTransport {
  constructor({accessToken, phoneNumberId, apiVersion = "v26.0", fetchImpl = fetch}) {
    if (!accessToken || !phoneNumberId) throw new Error("META_WHATSAPP_CREDENTIALS_REQUIRED");
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.apiVersion = apiVersion;
    this.fetch = fetchImpl;
    this.baseUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  }

  async request(payload) {
    const response = await this.fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({messaging_product: "whatsapp", recipient_type: "individual", ...payload})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `Meta API ${response.status}`;
      throw new Error(message);
    }
    return {id: data?.messages?.[0]?.id || null, raw: data};
  }

  async send({phone, body}) {
    if (!phone || !body) throw new Error("WHATSAPP_PHONE_AND_BODY_REQUIRED");
    return this.request({
      to: phone,
      type: "text",
      text: {preview_url: false, body: String(body).slice(0, 4096)}
    });
  }

  async sendTemplate({phone, name, language, body, components}) {
    if (!phone || !name || !language) throw new Error("WHATSAPP_APPROVED_TEMPLATE_REQUIRED");
    let templateComponents = Array.isArray(components) ? components : [];
    if (!templateComponents.length && body) {
      // Opt-in parameter mapping: use this only with a Meta-approved template containing one body variable.
      templateComponents = [{type: "body", parameters: [{type: "text", text: String(body).slice(0, 1024)}]}];
    }
    return this.request({
      to: phone,
      type: "template",
      template: {
        name,
        language: {code: language},
        ...(templateComponents.length ? {components: templateComponents} : {})
      }
    });
  }
}
