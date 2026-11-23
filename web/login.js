const password = document.getElementById('password');
const toggle = document.getElementById('togglePassword');
toggle.hidden = false;
toggle.addEventListener('click', () => {
  const reveal = password.type === 'password';
  password.type = reveal ? 'text' : 'password';
  toggle.textContent = reveal ? 'Ocultar' : 'Mostrar';
  toggle.setAttribute('aria-label', toggle.textContent + ' contraseña');
});
