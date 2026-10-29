// HTML form navigations use Referrer-Policy when constructing Origin. In
// particular, no-referrer turns it into "null", which the local agent rejects.
// Send only the Site origin; never disclose the pairing URL or state as Referer.
export function agentConnectResponse(port,state,token){
 const safe=token.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 const nonce=crypto.randomUUID().replaceAll('-','');
 return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="referrer" content="origin"><title>Подключение Codex</title><body><p>Подключаем локальный агент…</p><form method="POST" action="http://127.0.0.1:${port}/connect"><input type="hidden" name="state" value="${state}"><input type="hidden" name="token" value="${safe}"><button>Продолжить</button></form><script nonce="${nonce}">document.forms[0].submit();</script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'origin','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; form-action http://127.0.0.1:${port}; frame-ancestors 'none'`}});
}
