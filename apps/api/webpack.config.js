/**
 * bcrypt loads its native binding via node-pre-gyp, whose S3-fallback code
 * path pulls in optional deps (aws-sdk, mock-aws-s3, nock) that aren't
 * installed and don't need to be — that path never runs when the prebuilt
 * binary is already present locally. Webpack must not try to bundle bcrypt
 * at all; let Node's normal require() resolve it from node_modules at
 * runtime instead.
 */
module.exports = function (config) {
  const existingExternals = config.externals
    ? Array.isArray(config.externals)
      ? config.externals
      : [config.externals]
    : [];

  return {
    ...config,
    externals: [
      ...existingExternals,
      function ({ request }, callback) {
        if (request === "bcrypt") return callback(null, "commonjs bcrypt");
        callback();
      },
    ],
  };
};
