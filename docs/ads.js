/*
 * AD CONFIGURATION // DIGITAL COLLECTIVE ATLAS
 *
 * Every page on the site carries up to three ad slots:
 *   top     — banner under the tab bar
 *   inline  — mid-article, between sections
 *   bottom  — before the footer
 *
 * To turn ads on:
 *   1. Get approved for Google AdSense and copy your publisher ID (ca-pub-...).
 *   2. Paste it into `client` below.
 *   3. Optionally create ad units in AdSense and paste their slot IDs into `slots`.
 *      Leave a slot ID empty to use a responsive auto-sized unit instead.
 *   4. Add docs/ads.txt containing:
 *        google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
 *
 * While `client` is empty, slots stay collapsed for visitors. Append
 * `?ads=preview` to any URL (or open the site on localhost) to see where
 * the slots sit.
 */
window.DCA_ADS = {
  client: '', // e.g. 'ca-pub-1234567890123456'
  slots: {
    top: '',
    inline: '',
    bottom: ''
  }
};

(function () {
  const config = window.DCA_ADS;

  function previewMode() {
    try {
      if (new URLSearchParams(location.search).get('ads') === 'preview') return true;
    } catch (e) { /* ignore */ }
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  }

  function loadAdSense(client) {
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(client);
    document.head.appendChild(s);
  }

  function renderSlots() {
    const slots = document.querySelectorAll('.ad-slot[data-slot]');
    if (!slots.length) return;

    if (!config.client) {
      const preview = previewMode();
      slots.forEach((el) => {
        if (preview) {
          el.classList.add('ad-preview');
          el.textContent = 'AD SLOT // ' + el.dataset.slot.toUpperCase();
        } else {
          el.classList.add('ad-empty');
        }
      });
      return;
    }

    loadAdSense(config.client);
    slots.forEach((el) => {
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', config.client);
      const slotId = config.slots[el.dataset.slot];
      if (slotId) ins.setAttribute('data-ad-slot', slotId);
      // In-article units need a real slot ID; otherwise fall back to responsive auto.
      if (el.dataset.slot === 'inline' && slotId) {
        ins.setAttribute('data-ad-format', 'fluid');
        ins.setAttribute('data-ad-layout', 'in-article');
      } else {
        ins.setAttribute('data-ad-format', 'auto');
        ins.setAttribute('data-full-width-responsive', 'true');
      }
      el.appendChild(ins);
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSlots);
  } else {
    renderSlots();
  }
})();
