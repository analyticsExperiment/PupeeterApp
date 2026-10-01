(function () {
  const triggers = new WeakMap();
  window.FreeAuditReportUI = {
    openDialog(modal) {
      if (!modal) return;
      if (!triggers.has(modal)) triggers.set(modal, document.activeElement);
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', modal.id === 'modal' ? 'modalTitle' : 'interactionModalTitle');
      const close = modal.querySelector('#modalClose, #interactionModalClose');
      close?.focus({ preventScroll: true });
    },
    closeDialog(modal) {
      const trigger = triggers.get(modal);
      triggers.delete(modal);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
  };

  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const modal = document.querySelector('#modal:not(.hidden), #interactionModal:not(.hidden)');
    if (!modal) return;
    const controls = [...modal.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]')]
      .filter(node => node.tabIndex >= 0 && node.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (!modal.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
})();
