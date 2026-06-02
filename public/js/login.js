// Lógica del login.
const form = document.getElementById('loginForm');
const msg = document.getElementById('msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'msg';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await r.json();
    if (!r.ok) {
      msg.textContent = data.error || 'No se pudo ingresar';
      msg.className = 'msg error';
      return;
    }
    window.location.href = '/';
  } catch {
    msg.textContent = 'Error de conexión con el servidor';
    msg.className = 'msg error';
  }
});
