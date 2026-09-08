import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import test from "node:test";
import "../scripts/validator-guard.cjs";

const require = createRequire(import.meta.url);
const { imageSize } = require("image-size");

test("validator rejects vulnerable image formats before parsing, but permits SVG", () => {
  assert.throws(() => imageSize(Buffer.from("icns0000")), /disabled file type: icns/);
  assert.throws(() => imageSize(Buffer.from([0xff, 0x0a, 0, 0])), /disabled file type: jxl-stream/);
  const jxl = Buffer.alloc(24);
  jxl.writeUInt32BE(12, 0);
  jxl.write("JXL ", 4);
  jxl.writeUInt32BE(12, 12);
  jxl.write("ftypjxl ", 16);
  assert.throws(() => imageSize(jxl), /disabled file type: jxl/);
  const heif = Buffer.alloc(24);
  heif.writeUInt32BE(24, 0);
  heif.write("ftypheic", 4);
  assert.throws(() => imageSize(heif), /disabled file type: heif/);
  assert.equal(imageSize(Buffer.from('<svg width="48" height="48"></svg>')).width, 48);
});
