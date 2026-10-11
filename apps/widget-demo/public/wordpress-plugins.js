/**
 * The "plugins" for the WordPress host fixture.
 *
 * Plugin code is the part of a WordPress page nobody audits: it runs after the
 * theme, inserts nodes into a document the visitor is already reading, and
 * ships its own stylesheet from wherever it likes. This file reproduces the
 * three habits that give widgets trouble, at a size that can be read:
 *
 *   1. It mutates the page after load -- replacing a widget area's contents on a
 *      timer, the way a carousel or a "latest posts" block does.
 *   2. It injects a `<style>` element into the head *after* load, with rules
 *      aimed at `button` and at `body > div`. Late injection is the case a
 *      widget with a mount-time check would miss: the sheet did not exist when
 *      the widget mounted.
 *   3. It keeps a global and a jQuery-shaped namespace, because plugins do, and
 *      a widget that overwrites `window` globals would break them.
 *
 * Nothing here coordinates with the widget, and nothing here cleans up. If the
 * widget can be disturbed by any of it, that is the bug this fixture exists to
 * find.
 */
(function () {
  'use strict';

  var state = { renders: 0, accepted: false, injected: false };

  function injectLateStylesheet() {
    if (state.injected) return;
    state.injected = true;

    var style = document.createElement('style');
    style.id = 'harborough-plugin-inline-css';
    style.textContent = [
      '/* A plugin shipping its own button styling, injected after the page loaded. */',
      'button, .wp-element-button { border-radius: 0 !important; background-image: none !important; }',
      'body > div { border-style: dashed !important; }',
    ].join('\n');

    document.head.appendChild(style);
  }

  function renderWidgetArea() {
    var area = document.querySelector('.widget_block');
    if (!area) return;

    state.renders += 1;

    var heading = document.createElement('h2');
    heading.className = 'widget-title';
    heading.textContent = 'Latest news';

    var list = document.createElement('ul');
    for (var i = 0; i < 3; i += 1) {
      var item = document.createElement('li');
      item.textContent = 'Post ' + (state.renders * 3 + i + 1);
      list.appendChild(item);
    }

    area.replaceChildren(heading, list);
  }

  function startPolling() {
    // A poll every 250 ms, the way a plugin watching for a cart or a chat badge
    // would. It touches the page's DOM, never the widget's.
    window.setInterval(function () {
      renderWidgetArea();
      document.body.classList.toggle('plugin-polled');
    }, 250);
  }

  function bindConsent() {
    var button = document.getElementById('cookie-accept');
    if (!button) return;

    button.addEventListener('click', function () {
      state.accepted = true;
      var notice = document.getElementById('cookie-notice');
      if (notice) notice.remove();
    });
  }

  function ready() {
    injectLateStylesheet();
    bindConsent();
    startPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  } else {
    ready();
  }

  // The page's global namespace, which a badly-behaved widget might clobber.
  window.harborough = state;
})();
