// Phone-camera barcode scanning. Uses the browser's built-in BarcodeDetector when
// available (Chrome/Android) and falls back to ZXing everywhere else (iPhone Safari).
// Cameras need HTTPS (or localhost). Hand-held USB/Bluetooth scanners just type
// into the item-number field, so they work without any of this.
import { h, modal } from './ui.js';

let zxingLoading;
function loadZxing() {
  zxingLoading ??= new Promise((resolve, reject) => {
    if (window.ZXingBrowser) return resolve(window.ZXingBrowser);
    const s = document.createElement('script');
    s.src = 'vendor/zxing-browser.min.js';
    s.onload = () => resolve(window.ZXingBrowser);
    s.onerror = () => reject(new Error('Could not load the barcode reader'));
    document.head.append(s);
  });
  return zxingLoading;
}

export function scanBarcode() {
  return new Promise((resolve) => {
    const video = h('video', { playsinline: true, muted: true, autoplay: true });
    const status = h('p', { class: 'muted small' }, 'Point the camera at the barcode or QR label.');
    const manual = h('input', { placeholder: 'Or type the item number', autocomplete: 'off' });
    let stop = () => {};
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      stop();
      if (navigator.vibrate) navigator.vibrate(60);
      m.close();
      resolve(code || null);
    };
    const m = modal('Scan barcode', h('div', { class: 'scanner' }, video, status, manual), [
      { label: 'Cancel', onClick: () => finish(null) },
      { label: 'Use typed number', class: 'primary', onClick: () => { finish(manual.value.trim()); return false; } },
    ]);
    manual.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(manual.value.trim()); });
    m.closed.then(() => finish(null));

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        status.textContent = 'Camera not available here (cameras need HTTPS). Type the number instead.';
        return;
      }
      try {
        if ('BarcodeDetector' in window) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          video.srcObject = stream;
          stop = () => stream.getTracks().forEach((t) => t.stop());
          const detector = new window.BarcodeDetector();
          const tick = async () => {
            if (done) return;
            try {
              const codes = video.readyState >= 2 ? await detector.detect(video) : [];
              if (codes.length) return finish(codes[0].rawValue);
            } catch { /* frame not ready */ }
            requestAnimationFrame(tick);
          };
          tick();
        } else {
          const ZX = await loadZxing();
          const reader = new ZX.BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (result) => {
            if (result) finish(result.getText());
          });
          stop = () => controls.stop();
          if (done) stop();
        }
      } catch (e) {
        status.textContent = `Camera unavailable: ${e.message}. Type the number instead.`;
      }
    })();
  });
}
