import { novaS3Client } from "../src/nova-s3-client.js";
import assert from "assert";

async function testS3PutAndGet() {
  const key = `test-upload-${Date.now()}.txt`;
  const content = "Hello, SKALE S3!";
  const buffer = Buffer.from(content, "utf-8");

  // Upload
  const putResult = await novaS3Client.s3_put({
    key,
    value: buffer,
    content_type: "text/plain",
  });
  console.log("Upload result:", putResult);
  assert.strictEqual(putResult, true, "Upload should return true");

  // List
  const listResult = await novaS3Client.s3_list({ prefix: key.split("/")[0] });
  console.log("List result:", listResult);
  assert.ok(Array.isArray(listResult.keys), "List should return keys array");
  assert.ok(listResult.keys.includes(key), "Uploaded key should be in list");

  // Download
  const getResult = await novaS3Client.s3_get(key);
  assert.ok(getResult, "Should get a buffer");
  const downloaded = getResult.toString("utf-8");
  console.log("Downloaded content:", downloaded);
  assert.strictEqual(downloaded, content, "Downloaded content should match uploaded");

  // Delete
  const delResult = await novaS3Client.s3_delete(key);
  console.log("Delete result:", delResult);
  assert.strictEqual(delResult, true, "Delete should return true");

  // Confirm deletion
  const afterDel = await novaS3Client.s3_get(key);
  assert.strictEqual(afterDel, null, "Deleted key should not be retrievable");

  console.log("Test passed!");
}

testS3PutAndGet().catch(e => {
  console.error("Test failed:", e);
  process.exit(1);
});
