const TimelineService = require("./TimelineService");
const NotificationOrchestrator = require("./NotificationOrchestrator");

class RequestManagementService {
  static createRequest(caseData, payload, user, req) {
    const request = {
      name: payload.name || payload.title || payload.documentType,
      documentType: payload.documentType || "other",
      description: payload.description,
      required: payload.required !== false,
      category: payload.category || "general",
      status: "requested",
      requestedDate: new Date(),
      requestedBy: user?._id,
      dueDate: payload.dueDate,
      adminNotes: payload.notes,
      notes: payload.clientInstructions,
    };
    caseData.documentChecklist.push(request);
    caseData.checklistItems.push(request);
    const created = caseData.documentChecklist[caseData.documentChecklist.length - 1];
    TimelineService.add(caseData, "request", "Document Request Created", `${request.name} requested`, user, { requestId: created._id, documentType: request.documentType });
    TimelineService.addAudit(caseData, "request_created", user, request, req);
    return created;
  }

  static async create(caseData, payload, user, req) {
    const request = this.createRequest(caseData, payload, user, req);
    await caseData.save();
    await TimelineService.writeAudit("REQUEST_CREATED", "Case", caseData._id, user, { requestId: request._id, payload }, req);
    await NotificationOrchestrator.requestCreated(caseData, request, user, req);
    return request;
  }

  static async createFromGaps(caseData, gaps = [], user, req) {
    const created = [];
    for (const gap of gaps) {
      created.push(this.createRequest(caseData, {
        name: gap.evidenceKey?.replace(/_/g, " ") || gap,
        documentType: "other",
        category: "evidence",
        description: gap.reason || "Evidence requested from strategy gap analysis",
        required: true,
      }, user, req));
    }
    await caseData.save();
    await TimelineService.writeAudit("MISSING_EVIDENCE_REQUESTS_CREATED", "Case", caseData._id, user, { count: created.length }, req);
    return created;
  }

  static completeByDocument(caseData, document) {
    const matching = (caseData.documentChecklist || []).find((item) => item.documentType === document.documentType && ["pending", "requested", "missing", "overdue"].includes(item.status));
    if (!matching) return null;
    matching.status = "uploaded";
    matching.uploadedDate = new Date();
    matching.uploadedFiles = [...(matching.uploadedFiles || []), {
      originalName: document.originalName,
      storedName: document.storedName,
      storageKey: document.storageKey,
      size: document.size,
      mimeType: document.mimeType,
      uploadedAt: new Date(),
      document: document._id,
    }];
    return matching;
  }
}

module.exports = RequestManagementService;
