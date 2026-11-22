const test = require('node:test');
const assert = require('node:assert/strict');
const {cropRect} = require('../photo-crop.js');

test('portrait, landscape and square crops keep the 5:7 ratio inside image boundaries', () => {
  for (const [w,h] of [[500,700],[1600,900],[900,1600],[800,800]]) {
    for (const zoom of [1,2,4]) for (const x of [0,.5,1]) for (const y of [0,.5,1]) {
      const r = cropRect(w,h,zoom,x,y);
      assert.ok(Math.abs(r.width/r.height - 5/7)<1e-10);
      assert.ok(r.x>=0 && r.y>=0 && r.x+r.width<=w+1e-8 && r.y+r.height<=h+1e-8);
    }
  }
});
test('default crop is centered and zoom narrows both dimensions without distortion', () => {
  const first = cropRect(1000,1000), zoom = cropRect(1000,1000,2);
  assert.equal(first.y,0); assert.equal(first.x,(1000-first.width)/2);
  assert.equal(zoom.width,first.width/2); assert.equal(zoom.height,first.height/2);
});
