// Ora's face: the ORA mark drawn as a character. One SVG for the logo, avatars and states (idle, thinking, talking).
export function face(size = 32, state = '') {
  return '<svg class="ora-face ' + state + '" width="' + size + '" height="' + size + '" viewBox="0 0 64 64" aria-hidden="true">' +
    '<rect class="ora-head" x="4" y="4" width="56" height="56" rx="20"/>' +
    '<circle class="ora-cheek" cx="15" cy="39" r="4.5"/><circle class="ora-cheek" cx="49" cy="39" r="4.5"/>' +
    '<g class="ora-eyes"><ellipse cx="24" cy="28" rx="4.6" ry="6.2"/><ellipse cx="40" cy="28" rx="4.6" ry="6.2"/></g>' +
    '<path class="ora-mouth" d="M23 40.5q9 8 18 0"/></svg>';
}
