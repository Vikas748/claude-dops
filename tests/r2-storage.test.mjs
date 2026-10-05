import test from "node:test";
import assert from "node:assert/strict";
import { generateR2PresignedUrl, isR2Configured, getR2Config } from "../lib/r2-storage.ts";

test("R2 Storage: isR2Configured returns false when env is not set", () => {
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  assert.equal(isR2Configured(), false);
  assert.equal(getR2Config(), null);
});

test("R2 Storage: isR2Configured returns true when credentials exist", () => {
  process.env.R2_ACCOUNT_ID = "mock_acc_123";
  process.env.R2_ACCESS_KEY_ID = "mock_key_456";
  process.env.R2_SECRET_ACCESS_KEY = "mock_secret_789";
  assert.equal(isR2Configured(), true);
  const cfg = getR2Config();
  assert.equal(cfg?.accountId, "mock_acc_123");
  assert.equal(cfg?.bucket, "dops-private");
});

test("R2 Storage: generateR2PresignedUrl creates valid SigV4 S3 url", () => {
  const config = {
    accountId: "testaccount",
    accessKeyId: "testkey",
    secretAccessKey: "testsecret",
    bucket: "dops-private",
  };
  const url = generateR2PresignedUrl({
    config,
    key: "ot-images/patient_123.jpg",
    method: "PUT",
    expiresInSeconds: 7200,
  });

  assert.match(url, /^https:\/\/testaccount\.r2\.cloudflarestorage\.com\/dops-private\/ot-images\/patient_123\.jpg\?/);
  assert.match(url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.match(url, /X-Amz-Credential=testkey%2F\d{8}%2Fauto%2Fs3%2Faws4_request/);
  assert.match(url, /X-Amz-Expires=7200/);
  assert.match(url, /X-Amz-Signature=[0-9a-f]{64}/);
});
