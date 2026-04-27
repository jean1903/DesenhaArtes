const axios = require('axios');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const headers = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
});

async function getUsuario(email) {
  const res = await axios.get(
    `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&limit=1`,
    { headers: headers() }
  );
  return res.data[0] || null;
}

async function criarUsuario(id, email, senha) {
  await axios.post(
    `${SUPABASE_URL}/rest/v1/usuarios`,
    { id, email, senha, creditos: 0 },
    { headers: headers() }
  );
}

async function descontarCredito(email) {
  const u = await getUsuario(email);
  if (!u) return 0;
  const novos = Math.max(0, u.creditos - 1);
  await axios.patch(
    `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}`,
    { creditos: novos },
    { headers: headers() }
  );
  return novos;
}

async function adicionarCreditos(email, quantidade) {
  const u = await getUsuario(email);
  if (!u) return false;
  const novos = u.creditos + quantidade;
  await axios.patch(
    `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}`,
    { creditos: novos },
    { headers: headers() }
  );
  return novos;
}

async function salvarArte(email, urlPrevia, urlFinal) {
  await axios.post(
    `${SUPABASE_URL}/rest/v1/artes`,
    { email, url_previa: urlPrevia, url_final: urlFinal, pago: false },
    { headers: headers() }
  );
}

async function getArtes(email) {
  const res = await axios.get(
    `${SUPABASE_URL}/rest/v1/artes?email=eq.${encodeURIComponent(email)}&order=criado_em.desc&limit=50`,
    { headers: headers() }
  );
  return res.data || [];
}

async function liberarArte(arteId) {
  await axios.patch(
    `${SUPABASE_URL}/rest/v1/artes?id=eq.${arteId}`,
    { pago: true },
    { headers: headers() }
  );
}

async function pagamentoJaProcessado(paymentId) {
  try {
    const res = await axios.get(
      `${SUPABASE_URL}/rest/v1/pagamentos_processados?payment_id=eq.${paymentId}&limit=1`,
      { headers: headers() }
    );
    return res.data.length > 0;
  } catch { return false; }
}

async function marcarPagamentoProcessado(paymentId) {
  try {
    await axios.post(
      `${SUPABASE_URL}/rest/v1/pagamentos_processados`,
      { payment_id: String(paymentId) },
      { headers: headers() }
    );
  } catch(e) { console.log('Erro ao marcar pagamento:', e.message); }
}

module.exports = {
  getUsuario, criarUsuario, descontarCredito, adicionarCreditos,
  salvarArte, getArtes, liberarArte,
  pagamentoJaProcessado, marcarPagamentoProcessado
};
