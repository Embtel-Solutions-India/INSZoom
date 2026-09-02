// Pure Adobe PDF Services REST wrapper. No CaseForm/USCIS business logic
// belongs here - callers hand this a PDF buffer and a plain field/value map,
// and get a filled PDF buffer back.
//
// Productionized directly from the proven POC (Backend/src/scripts/
// adobeFormFillPoc.js), which passed every test in its scope against the
// real Adobe API and the real I-129 template. The call sequence, endpoint
// paths, and the "no Node SDK support" finding are unchanged from that POC:
// the official @adobe/pdfservices-node-sdk (v4.1.0, checked directly against
// its published tarball, not assumed) has no Import/Export PDF Form Data job
// class - only documentmerge, createpdf, combinepdf, ocr, exportpdf, etc. -
// so this calls the real REST endpoints directly, verified against Adobe's
// own published OpenAPI spec.
const env = require("../../config/env");

class AdobePdfService {
  static _tokenCache = null; // { accessToken, expiresAt }

  static baseUrl() {
    return env.adobe.baseUrl;
  }

  static async authenticate() {
    if (this._tokenCache && this._tokenCache.expiresAt > Date.now() + 5000) {
      return this._tokenCache.accessToken;
    }
    const { clientId, clientSecret } = env.adobe;
    if (!clientId) this._fail("ADOBE_AUTH_FAILED", "ADOBE_PDF_SERVICES_CLIENT_ID is not configured", 500);
    if (!clientSecret) this._fail("ADOBE_AUTH_FAILED", "ADOBE_PDF_SERVICES_CLIENT_SECRET is not configured", 500);

    let res;
    try {
      res = await fetch(`${this.baseUrl()}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }).toString(),
      });
    } catch (error) {
      this._fail("ADOBE_AUTH_FAILED", `Adobe /token request failed: ${error.message}`, 502);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      // Never log/include client_secret - only the response Adobe itself sent back.
      this._fail("ADOBE_AUTH_FAILED", `Adobe authentication failed (HTTP ${res.status})`, 502);
    }
    this._tokenCache = { accessToken: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3000) * 1000 };
    return json.access_token;
  }

  static async authHeaders() {
    const accessToken = await this.authenticate();
    return { Authorization: `Bearer ${accessToken}`, "x-api-key": env.adobe.clientId };
  }

  static async uploadAsset(buffer) {
    const headers = await this.authHeaders();
    let presignRes;
    try {
      presignRes = await fetch(`${this.baseUrl()}/assets`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ mediaType: "application/pdf" }),
      });
    } catch (error) {
      this._fail("ADOBE_ASSET_UPLOAD_FAILED", `Adobe /assets request failed: ${error.message}`, 502);
    }
    const presignJson = await presignRes.json().catch(() => ({}));
    if (!presignRes.ok || !presignJson.uploadUri || !presignJson.assetID) {
      this._fail("ADOBE_ASSET_UPLOAD_FAILED", `Adobe asset upload presign failed (HTTP ${presignRes.status})`, 502);
    }
    let putRes;
    try {
      putRes = await fetch(presignJson.uploadUri, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: buffer });
    } catch (error) {
      this._fail("ADOBE_ASSET_UPLOAD_FAILED", `Uploading PDF bytes to Adobe failed: ${error.message}`, 502);
    }
    if (!putRes.ok) this._fail("ADOBE_ASSET_UPLOAD_FAILED", `Uploading PDF bytes to Adobe failed (HTTP ${putRes.status})`, 502);
    return presignJson.assetID;
  }

  static async setFormData(assetId, jsonFormFieldsData) {
    const headers = await this.authHeaders();
    let res;
    try {
      res = await fetch(`${this.baseUrl()}/operation/setformdata`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ assetID: assetId, jsonFormFieldsData }),
      });
    } catch (error) {
      this._fail("ADOBE_SETFORMDATA_FAILED", `Adobe /operation/setformdata request failed: ${error.message}`, 502);
    }
    if (res.status !== 201) {
      const body = await res.text().catch(() => "");
      this._fail("ADOBE_SETFORMDATA_FAILED", `Adobe form-fill request failed (HTTP ${res.status}): ${body.slice(0, 500)}`, 502);
    }
    const location = res.headers.get("location");
    if (!location) this._fail("ADOBE_SETFORMDATA_FAILED", "Adobe returned 201 with no job-status location header", 502);
    return location;
  }

  static async waitForJob(location, timeoutMs = 120000, pollIntervalMs = 2000) {
    const headers = await this.authHeaders();
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      const res = await fetch(location, { headers });
      last = await res.json().catch(() => ({}));
      if (last.status === "done") return last;
      if (last.status === "failed") {
        this._fail("ADOBE_JOB_FAILED", `Adobe form-fill job failed: ${last.error?.message || JSON.stringify(last.error)}`, 502);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    this._fail("ADOBE_JOB_TIMEOUT", `Adobe form-fill job did not complete within ${timeoutMs}ms`, 504);
  }

  static async downloadResult(job) {
    const downloadUri = job?.asset?.downloadUri;
    if (!downloadUri) this._fail("ADOBE_DOWNLOAD_FAILED", "Adobe job completed with no downloadUri", 502);
    let res;
    try {
      res = await fetch(downloadUri);
    } catch (error) {
      this._fail("ADOBE_DOWNLOAD_FAILED", `Downloading Adobe's result failed: ${error.message}`, 502);
    }
    if (!res.ok) this._fail("ADOBE_DOWNLOAD_FAILED", `Downloading Adobe's result failed (HTTP ${res.status})`, 502);
    return Buffer.from(await res.arrayBuffer());
  }

  // Composes the above into the one call other code needs: a PDF buffer and
  // a field/value map in, a filled PDF buffer out.
  static async fillPdf(buffer, jsonFormFieldsData) {
    const assetId = await this.uploadAsset(buffer);
    const location = await this.setFormData(assetId, jsonFormFieldsData);
    const job = await this.waitForJob(location);
    return this.downloadResult(job);
  }

  static _fail(code, message, status) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    throw error;
  }
}

module.exports = AdobePdfService;
