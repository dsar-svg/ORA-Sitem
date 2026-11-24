// Ora, the owl analyst: one portrait per state, small files for avatars and the large one for her greeting.
export function face(size = 32, state = '') {
  const file = (state === 'thinking' ? 'ora-pensando' : 'ora') + (size > 96 ? '' : '-128');
  return '<img class="ora-face ' + state + '" src="/ora/' + file + '.webp" width="' + size + '" height="' + size + '" alt="" decoding="async">';
}
