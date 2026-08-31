const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const caseService = require("../../cases/case.service");
const documentService = require("../../documents/document.service");

describe("Phase 10 restricted employee/beneficiary portal RBAC", () => {
  const principalId = "65f000000000000000000001";
  const employeeCaseId = "65f000000000000000000002";
  const siblingCaseId = "65f000000000000000000003";
  const beneficiaryCaseId = "65f000000000000000000004";
  const employeeUserId = "65f000000000000000000011";
  const siblingUserId = "65f000000000000000000012";
  const beneficiaryUserId = "65f000000000000000000013";

  const employeeUser = {
    _id: employeeUserId,
    role: "employee",
    primaryCaseId: employeeCaseId,
    caseIds: [employeeCaseId],
    principalCaseId: principalId,
    email: "employee@example.com",
  };

  const beneficiaryUser = {
    _id: beneficiaryUserId,
    role: "beneficiary",
    primaryCaseId: beneficiaryCaseId,
    caseIds: [beneficiaryCaseId],
    principalCaseId: principalId,
    email: "beneficiary@example.com",
  };

  const ownEmployeeCase = {
    _id: employeeCaseId,
    user: employeeUserId,
    caseRole: "employee",
    parentCase: principalId,
  };

  it("allows an employee to access and upload only for their own employee child case", () => {
    assert.equal(caseService.canAccessCase(employeeUser, ownEmployeeCase), true);
    assert.equal(documentService.canUploadForCase(employeeUser, ownEmployeeCase), true);
  });

  it("denies employee access to the principal case, even under the same matter", () => {
    const principalCase = {
      _id: principalId,
      user: "65f000000000000000000020",
      caseRole: "principal",
    };

    assert.equal(caseService.canAccessCase(employeeUser, principalCase), false);
    assert.equal(documentService.canUploadForCase(employeeUser, principalCase), false);
  });

  it("denies employee access to sibling child cases under the same principal", () => {
    const siblingCase = {
      _id: siblingCaseId,
      user: siblingUserId,
      caseRole: "employee",
      parentCase: principalId,
    };

    assert.equal(caseService.canAccessCase(employeeUser, siblingCase), false);
    assert.equal(documentService.canUploadForCase(employeeUser, siblingCase), false);
  });

  it("requires the restricted role to match the child case role", () => {
    const beneficiaryCase = {
      _id: beneficiaryCaseId,
      user: beneficiaryUserId,
      caseRole: "beneficiary",
      parentCase: principalId,
    };

    assert.equal(caseService.canAccessCase(employeeUser, beneficiaryCase), false);
    assert.equal(caseService.canAccessCase(beneficiaryUser, beneficiaryCase), true);
    assert.equal(documentService.canUploadForCase(beneficiaryUser, beneficiaryCase), true);
  });

  it("builds employee list filters from server-authorized case ids only", () => {
    const filter = caseService.buildCaseFilter({ status: "active" }, employeeUser);

    assert.equal(filter.status, "active");
    assert.equal(filter.$and.length, 1);
    assert.equal(filter.$and[0].caseRole, "employee");
    assert.deepEqual(filter.$and[0]._id.$in.map(String), [employeeCaseId]);
    assert.equal(String(filter.$and[0].parentCase), principalId);
  });
});
