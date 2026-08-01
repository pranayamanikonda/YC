import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveEnv,
  isHttpsPublicUrl,
  parsePublicUrl,
  DERIVED_ENV_KEYS,
} from "../src/contract/env.mjs";

test("derives every surface from publicUrl", () => {
  const env = deriveEnv("https://qm.acme.com");
  assert.equal(env.QM_PUBLIC_URL, "https://qm.acme.com");
  assert.equal(env.QM_CORE_URL, "https://qm.acme.com/");
  assert.equal(env.QM_ADMIN_URL, "https://qm.acme.com/admin");
  assert.equal(env.QM_PORTAL_URL, "https://qm.acme.com/portal");
  assert.equal(env.QM_SLACK_EVENTS_URL, "https://qm.acme.com/slack/events");
});

test("slack oidc redirect matches <publicUrl>/auth/callback exactly", () => {
  const env = deriveEnv("https://qm.acme.com");
  assert.equal(env.QM_SLACK_OIDC_REDIRECT_URL, "https://qm.acme.com/auth/callback");
});

test("honors a base path in publicUrl", () => {
  const env = deriveEnv("https://acme.com/qm/");
  assert.equal(env.QM_PUBLIC_URL, "https://acme.com/qm");
  assert.equal(env.QM_ADMIN_URL, "https://acme.com/qm/admin");
  assert.equal(env.QM_SLACK_OIDC_REDIRECT_URL, "https://acme.com/qm/auth/callback");
});

test("every derived key is listed for the no-secret-values check", () => {
  const env = deriveEnv("https://qm.acme.com");
  for (const key of Object.keys(env)) {
    assert.ok(DERIVED_ENV_KEYS.includes(key), `${key} should be a reserved derived key`);
  }
});

test("isHttpsPublicUrl distinguishes scheme", () => {
  assert.equal(isHttpsPublicUrl("https://x.com"), true);
  assert.equal(isHttpsPublicUrl("http://x.com"), false);
  assert.equal(isHttpsPublicUrl("not a url"), false);
});

test("parsePublicUrl rejects non-http(s) and garbage", () => {
  assert.throws(() => parsePublicUrl("ftp://x.com"));
  assert.throws(() => parsePublicUrl(""));
  assert.throws(() => parsePublicUrl("qm.acme.com"));
});
