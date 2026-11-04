export class OrbitClient {
  constructor({baseUrl, token, fetchImpl = fetch}) {
    this.baseUrl = baseUrl.replace(/\\/$/, "");
    this.token = token;
    this.fetch = fetchImpl;
  }

  async request(path, options = {}) {
    const response = await this.fetch(this.baseUrl + path, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`WA Orbit API ${response.status}`);
    return response.json();
  }

  drafts(status = "approved") {
    return this.request(`/api/drafts?status=${encodeURIComponent(status)}`);
  }

  safety() {
    return this.request("/api/safety");
  }

  approveDraft(id, body) {
    return this.request(`/api/drafts/${id}`, {
      method: "POST",
      body: JSON.stringify({status:"approved", body})
    });
  }

  ingestStatus(statuses) {
    return this.request("/api/status-events", {
      method: "POST",
      body: JSON.stringify({statuses})
    });
  }
}
