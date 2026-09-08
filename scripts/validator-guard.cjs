// Development-only mitigation for GHSA-w3rx-r6r6-pgpr / GHSA-5p2g-fcmc-qvqq.
// addons-linter uses this CommonJS instance. Reject vulnerable formats before
// their parsers run. TraceLens ships SVG icons and does not need these formats.
const { disableTypes } = require("image-size");
disableTypes(["icns", "jxl", "jxl-stream", "heif"]);
