/* Cropping is local and transactional: cancel never changes the stored photo. */
(function (root) {
  function cropRect(width, height, zoom = 1, x = .5, y = .5) {
    const baseWidth = Math.min(width, height * 5 / 7);
    const w = baseWidth / Math.max(1, zoom), h = w * 7 / 5;
    return {x: (width - w) * Math.max(0, Math.min(1, x)), y: (height - h) * Math.max(0, Math.min(1, y)), width: w, height: h};
  }
  let cropping = false;
  async function open(source) {
    if (cropping) return null;
    cropping = true;
    let image;
    try {
    image = await createImageBitmap(source, {imageOrientation: 'from-image'});
    return await new Promise(resolve => {
      const dialog = document.createElement('dialog'); dialog.id = 'photo-crop-dialog'; dialog.setAttribute('aria-labelledby', 'crop-title');
      dialog.innerHTML = `<h2 id="crop-title">裁剪简历照片</h2><p class="crop-hint">默认一寸照片比例（25:35）。拖动照片调整位置，也可使用下方滑块。确认后同步至所有方向简历。</p><div class="crop-stage"><canvas class="crop-canvas" width="500" height="700" role="img" aria-label="一寸比例裁剪预览"></canvas></div><div class="crop-controls"><label>缩放<input name="zoom" type="range" min="1" max="4" step="0.01" value="1"></label><label>水平位置<input name="x" type="range" min="0" max="1" step="0.01" value="0.5"></label><label>垂直位置<input name="y" type="range" min="0" max="1" step="0.01" value="0.5"></label></div><div class="crop-actions"><button type="button" class="secondary" data-crop="reset">重置位置</button><button type="button" class="secondary" data-crop="cancel">取消</button><button type="button" class="primary" data-crop="apply">使用裁剪照片</button></div>`;
      document.body.append(dialog);
      const canvas = dialog.querySelector('canvas'), ctx = canvas.getContext('2d');
      const input = key => dialog.querySelector(`[name="${key}"]`);
      const values = () => ['zoom','x','y'].map(key => Number(input(key).value));
      let rect, drag = null, settled = false;
      function draw() {
        rect = cropRect(image.width, image.height, ...values());
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,500,700);
        ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0,0,500,700);
      }
      function finish(value) { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(value); }
      dialog.addEventListener('input', draw);
      dialog.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
      dialog.addEventListener('close', () => { if (!settled) finish(null); });
      dialog.querySelector('[data-crop=cancel]').onclick = () => finish(null);
      dialog.querySelector('[data-crop=apply]').onclick = () => finish(canvas.toDataURL('image/jpeg', .92));
      dialog.querySelector('[data-crop=reset]').onclick = () => { input('zoom').value = 1; input('x').value = input('y').value = .5; draw(); };
      canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); drag = {x:e.clientX,y:e.clientY,px:Number(input('x').value),py:Number(input('y').value),rect}; });
      canvas.addEventListener('pointermove', e => {
        if (!drag) return;
        const scale = drag.rect.width / canvas.getBoundingClientRect().width;
        for (const [key,delta,space,start] of [['x',e.clientX-drag.x,image.width-drag.rect.width,drag.px],['y',e.clientY-drag.y,image.height-drag.rect.height,drag.py]]) {
          input(key).value = space > 0 ? Math.max(0,Math.min(1,start-delta*scale/space)) : .5;
        }
        draw();
      });
      canvas.addEventListener('pointerup', () => { drag = null; }); canvas.addEventListener('pointercancel', () => { drag = null; });
      draw(); dialog.showModal(); input('zoom').focus();
    });
    } finally { cropping = false; image?.close(); }
  }
  root.PhotoCrop = {open, cropRect};
  if (typeof module !== 'undefined') module.exports = {cropRect};
})(typeof window === 'undefined' ? globalThis : window);
