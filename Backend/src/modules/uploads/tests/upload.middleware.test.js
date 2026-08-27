const assert = require("node:assert/strict");
const test = require("node:test");

const middlewarePath = require.resolve("../upload.middleware");

function loadUploadWithEnv(env) {
  const previousUploadSize = process.env.MAX_UPLOAD_SIZE_BYTES;
  const previousFileSize = process.env.MAX_FILE_SIZE;
  if (env.MAX_UPLOAD_SIZE_BYTES === undefined) delete process.env.MAX_UPLOAD_SIZE_BYTES;
  else process.env.MAX_UPLOAD_SIZE_BYTES = env.MAX_UPLOAD_SIZE_BYTES;
  if (env.MAX_FILE_SIZE === undefined) delete process.env.MAX_FILE_SIZE;
  else process.env.MAX_FILE_SIZE = env.MAX_FILE_SIZE;

  delete require.cache[middlewarePath];
  const upload = require("../upload.middleware");

  if (previousUploadSize === undefined) delete process.env.MAX_UPLOAD_SIZE_BYTES;
  else process.env.MAX_UPLOAD_SIZE_BYTES = previousUploadSize;
  if (previousFileSize === undefined) delete process.env.MAX_FILE_SIZE;
  else process.env.MAX_FILE_SIZE = previousFileSize;
  delete require.cache[middlewarePath];

  return upload;
}

test("upload middleware respects MAX_FILE_SIZE as a fallback", () => {
  const upload = loadUploadWithEnv({
    MAX_UPLOAD_SIZE_BYTES: undefined,
    MAX_FILE_SIZE: "26214400",
  });

  assert.equal(upload.limits.fileSize, 26214400);
});

test("upload middleware prefers MAX_UPLOAD_SIZE_BYTES when both upload limit env vars are set", () => {
  const upload = loadUploadWithEnv({
    MAX_UPLOAD_SIZE_BYTES: "25165824",
    MAX_FILE_SIZE: "26214400",
  });

  assert.equal(upload.limits.fileSize, 25165824);
});
