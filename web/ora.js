// Ora's avatar is the ORA mark itself: a focus frame around a point, with the gold corner. The corner pulses while she thinks.
export function face(size = 32, state = '') {
  return '<span class="ora-face mark ' + state + '" style="width:' + size + 'px;height:' + size + 'px" aria-hidden="true">' +
    '<svg viewBox="0 0 48 48"><rect x="7" y="7" width="34" height="34" rx="10" fill="none" stroke="currentColor" stroke-width="5.5"/>' +
    '<circle cx="24" cy="24" r="4.5" fill="currentColor"/><rect class="corner" x="33" y="4" width="11" height="11" rx="2.5"/></svg></span>';
}
