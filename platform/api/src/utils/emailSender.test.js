import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-must-be-at-least-32-characters-long";

const {
  createEmailTransporter,
  isEmailConfigured,
  sendTransactionalEmail,
} = await import("./emailSender.js");

test("email config is disabled without host in smtp mode", () => {
  assert.equal(isEmailConfigured({ transport: "", host: "", from: "noreply@test.local" }), false);
});

test("json transport is considered configured for tests", () => {
  assert.equal(isEmailConfigured({ transport: "json", from: "noreply@test.local" }), true);
  assert.ok(createEmailTransporter({ transport: "json", from: "noreply@test.local" }));
});

test("sendTransactionalEmail works with json transport", async () => {
  const info = await sendTransactionalEmail({
    to: ["mario@example.com"],
    subject: "Ciao",
    text: "Messaggio di test",
  }, {
    transport: "json",
    from: "noreply@test.local",
  });

  assert.ok(info.messageId);
  assert.equal(info.envelope.from, "noreply@test.local");
  assert.deepEqual(info.envelope.to, ["mario@example.com"]);
  assert.match(info.message.toString(), /Messaggio di test/);
});
