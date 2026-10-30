(function () {
  'use strict';

  const menu = document.querySelector('.menu');
  if (!menu) {
    return;
  }
  const button = menu.querySelector('.menu-btn');
  const canHover = window.matchMedia('(hover: hover)');

  function setOpen(open) {
    menu.classList.toggle('open', open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  button.addEventListener('click', function () {
    if (canHover.matches) {
      return;
    }
    setOpen(!menu.classList.contains('open'));
  });

  document.addEventListener('click', function (e) {
    if (!menu.contains(e.target)) {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      setOpen(false);
      button.blur();
    }
  });
})();
