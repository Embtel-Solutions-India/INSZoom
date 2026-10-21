const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Conversation = require("../../../models/Conversation");
const Message = require("../../../models/Message");
const Feedback = require("../../../models/Feedback");
const messageService = require("../message.service");
const feedbackService = require("../../feedback/feedback.service");

// Edit in place / delete for everyone, on the dedicated local test database only (never the shared one).
const id = () => new mongoose.Types.ObjectId();
const sender = { _id: id(), role: "client" };
const other = { _id: id(), role: "case_manager" };
const admin = { _id: id(), role: "admin" };

test.before(connectTestDB);
test.after(async () => {
  await Message.deleteMany({ senderName: "ZZ-TMP-EDIT-DELETE" });
  await Conversation.deleteMany({ subject: "ZZ-TMP-EDIT-DELETE" });
  await Feedback.deleteMany({ message: /^ZZ-TMP-EDIT-DELETE/ });
  await disconnectTestDB();
});

async function makeThread() {
  const conversation = await Conversation.create({ type: "case", subject: "ZZ-TMP-EDIT-DELETE", clientId: sender._id, participants: [{ user: sender._id }, { user: other._id }] });
  const message = await Message.create({
    conversationId: conversation._id, senderId: sender._id, sender: "client", senderName: "ZZ-TMP-EDIT-DELETE",
    messageBody: "hello there", attachments: [{ originalName: "a.pdf", storageKey: "feedback/a.pdf" }], reactions: [{ emoji: "👍", userId: other._id }],
  });
  conversation.lastMessagePreview = "hello there";
  await conversation.save();
  return { conversation, message };
}

test("the sender edits a message in place: new text, edited mark, same message", async () => {
  const { message } = await makeThread();
  const updated = await messageService.editMessage(message, { messageBody: "hello again" }, sender, {});
  assert.equal(String(updated._id), String(message._id));
  assert.equal(updated.messageBody, "hello again");
  assert.ok(updated.editedAt);
});

test("someone else cannot edit it, and an empty text is refused", async () => {
  const { message } = await makeThread();
  await assert.rejects(() => messageService.editMessage(message, { messageBody: "hijack" }, other, {}), (error) => error.status === 403);
  const fresh = await Message.create({ conversationId: message.conversationId, senderId: sender._id, sender: "client", senderName: "ZZ-TMP-EDIT-DELETE", messageBody: "only text" });
  await assert.rejects(() => messageService.editMessage(fresh, { messageBody: "   " }, sender, {}), (error) => error.status === 400);
});

test("delete for everyone: only the sender; the message stays but its content, files and reactions are gone", async () => {
  const { conversation, message } = await makeThread();
  await assert.rejects(() => messageService.deleteMessageForEveryone(message, other, {}), (error) => error.status === 403);
  await assert.rejects(() => messageService.deleteMessageForEveryone(message, admin, {}), (error) => error.status === 403);

  const deleted = await messageService.deleteMessageForEveryone(message, sender, {});
  assert.ok(deleted.deletedForEveryoneAt);
  const stored = await Message.findById(message._id).lean();
  assert.equal(stored.deletedAt, undefined, "it is still listed in the thread");
  assert.equal(stored.messageBody, "");
  assert.equal(stored.message, "");
  assert.equal((stored.attachments || []).length, 0);
  assert.equal((stored.reactions || []).length, 0);
  assert.ok(stored.deletedForEveryoneAt);

  const refreshed = await Conversation.findById(conversation._id).lean();
  assert.equal(refreshed.lastMessagePreview, "This message was deleted");

  // (the service populates the document it returns, so each call below starts from a fresh copy, as a real request does)
  await assert.rejects(async () => messageService.editMessage(await Message.findById(message._id), { messageBody: "back from the dead" }, sender, {}), (error) => error.status === 400);
  await assert.rejects(async () => messageService.addReaction(await Message.findById(message._id), "👍", other, {}), (error) => error.status === 400);
  // a second delete is harmless
  await messageService.deleteMessageForEveryone(await Message.findById(message._id), sender, {});
});

test("attorney / staff feedback: the author edits in place and deletes for everyone; others cannot", async () => {
  const caseId = id();
  const feedback = await Feedback.create({ caseId, authorId: sender._id, authorRole: "attorney", message: "ZZ-TMP-EDIT-DELETE first", attachments: [{ originalName: "b.pdf", storageKey: "feedback/b.pdf" }] });

  const edited = await feedbackService.editFeedback({ caseId, feedbackId: feedback._id, author: sender, message: "ZZ-TMP-EDIT-DELETE second" });
  assert.equal(edited.message, "ZZ-TMP-EDIT-DELETE second");
  assert.ok(edited.editedAt);
  await assert.rejects(() => feedbackService.editFeedback({ caseId, feedbackId: feedback._id, author: other, message: "ZZ-TMP-EDIT-DELETE x" }), (error) => error.status === 403);
  const plain = await Feedback.create({ caseId, authorId: sender._id, authorRole: "attorney", message: "ZZ-TMP-EDIT-DELETE plain" });
  await assert.rejects(() => feedbackService.editFeedback({ caseId, feedbackId: plain._id, author: sender, message: "  " }), (error) => error.status === 400);

  await assert.rejects(() => feedbackService.deleteFeedbackForEveryone({ caseId, feedbackId: feedback._id, author: other }), (error) => error.status === 403);
  const deleted = await feedbackService.deleteFeedbackForEveryone({ caseId, feedbackId: feedback._id, author: sender });
  assert.ok(deleted.deletedForEveryoneAt);
  assert.equal(deleted.message, "");
  assert.equal((deleted.attachments || []).length, 0);
  const listed = await feedbackService.listFeedback(caseId);
  assert.equal(listed.length, 2, "the deleted message is still in the thread");
  await assert.rejects(() => feedbackService.editFeedback({ caseId, feedbackId: feedback._id, author: sender, message: "ZZ-TMP-EDIT-DELETE again" }), (error) => error.status === 400);
});
