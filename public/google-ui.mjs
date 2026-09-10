let sdk;
let optionsQueue = Promise.resolve();
export function orderedGoogleOptions(container, api) {
  const request = optionsQueue.catch(() => {}).then(() => container.isConnected ? api('/auth/options') : null);
  optionsQueue = request.then(() => {}, () => {});
  return request;
}
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!sdk) sdk = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = resolve;
    script.onerror = () => { sdk = null; script.remove(); reject(Error('Não foi possível carregar o Google. Verifique sua conexão e atualize a página.')); };
    document.head.append(script);
  });
  return sdk;
}

export async function mountGoogle(container, { api, onSuccess }) {
  container.innerHTML = '<h3>Donos de loja</h3><p>Entre com Google. No primeiro acesso, você escolhe o nome da sua loja.</p><div class="google-button"></div><p class="error" role="alert"></p>';
  const error = container.querySelector('.error');
  try {
    const settings = await orderedGoogleOptions(container, api);
    if (!settings?.google_client_id || !container.isConnected) return;
    await loadGoogle();
    if (!container.isConnected) return;
    let busy = false;
    window.google.accounts.id.initialize({
      client_id: settings.google_client_id, nonce: settings.nonce, auto_select: false,
      ux_mode: 'popup', context: 'signin',
      callback: async response => {
        if (busy || !container.isConnected) return;
        busy = true; error.textContent = '';
        try {
          const result = await api('/auth/google', { credential: response.credential });
          if (!result.needs_store) { await onSuccess(); return; }
          container.innerHTML = '<h3>Crie sua loja</h3><p class="google-account"></p><form><label>Nome da loja<input name="store_name" required maxlength="120" autocomplete="organization"></label><p class="error" role="alert"></p><button type="submit" class="primary">Criar minha loja</button></form><p class="footer-note">Esta será uma loja nova e independente. Seus vendedores serão cadastrados nas configurações.</p>';
          container.querySelector('.google-account').textContent = `Conta Google: ${result.email}`;
          const form = container.querySelector('form');
          form.addEventListener('submit', async event => {
            event.preventDefault(); event.stopPropagation();
            const button = form.querySelector('button'); if (button.disabled) return;
            button.disabled = true;
            try { await api('/auth/google/store', { store_name: new FormData(form).get('store_name') }); await onSuccess(); }
            catch (err) { form.querySelector('.error').textContent = err.message; }
            finally { button.disabled = false; }
          });
          form.querySelector('input').focus();
        } catch (err) {
          error.textContent = err.message + ' Atualize a página para tentar novamente.';
        } finally { busy = false; }
      }
    });
    window.google.accounts.id.renderButton(container.querySelector('.google-button'), { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', locale: 'pt-BR', width: Math.min(360, Math.max(200, container.clientWidth)) });
  } catch (err) { error.textContent = err.message; }
}
