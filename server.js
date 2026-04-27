require('dotenv').config();
const express  = require('express');
const axios    = require('axios');
const path     = require('path');
const FormData = require('form-data');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const sharp    = require('sharp');
const { v4: uuidv4 } = require('uuid');
const db       = require('./db');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET   = process.env.JWT_SECRET   || 'desenhaarte-secret-2025';
const ADMIN_SECRET = process.env.ADMIN_SECRET  || 'admin123';
const MP_TOKEN     = process.env.MP_ACCESS_TOKEN;
const BASE_URL     = process.env.BASE_URL      || 'https://desenhaarte.up.railway.app';

const PLANOS = {
  arte: { nome: 'Liberar Retrato', creditos: 1, preco: 5.90 },
};

const PROMPT = `ULTRA REALISTIC PENCIL PORTRAIT – FACE PRESERVATION MODE
Transform the provided image into an ultra-realistic graphite pencil portrait drawn on clean white paper.
CRITICAL INSTRUCTION — FACE PRESERVATION:
The face must remain EXACTLY the same as the original image.
Preserve 100% of the original facial features, proportions, identity, expression, age, hairstyle and clothing.
Do NOT modify the face in any way.
Do NOT change facial structure.
Do NOT change age or make the person older or younger.
Do NOT add wrinkles, expression lines or skin folds that are not present in the original image.
Do NOT beautify, stylize, exaggerate or distort the face.
The identity of the person must remain perfectly identical to the original photo.
This is a strict portrait translation task: convert the photo into a graphite pencil drawing while preserving the exact identity of the person.
ART STYLE: Ultra-realistic graphite pencil drawing. Black and white only. Professional hand-drawn portrait. Fine pencil strokes with controlled technique. Smooth and soft shading gradients. Realistic light and shadow. Natural graphite texture.
DRAWING QUALITY: The drawing must look clean, refined and professionally executed. Avoid messy sketching, chaotic lines or heavy scribbles. Use smooth and organized pencil strokes. Shading must be polished and balanced. The result should resemble a museum-quality portrait artwork drawn by a highly skilled professional artist.
FACE DETAILING: Highly detailed eyes. Natural skin texture translated into subtle graphite shading. Accurate proportions and symmetry. Realistic depth and contrast.
PAPER: Visible natural paper texture. Clean white background. Looks like real drawing paper.
IMAGE QUALITY: Ultra high resolution. Sharp details. Balanced contrast. Professional portrait composition.
NEGATIVE PROMPT: cartoon, anime, illustration, stylized drawing, caricature, exaggerated features, altered face, different identity, fake face, distorted proportions, aging effects, extra wrinkles, beauty filter, painting, oil painting, watercolor, colored pencils, ink, charcoal, messy sketch, excessive scribbles, rough strokes, low quality, blurry image, unrealistic shading, digital painting style`;

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ erro: 'Não autenticado.' });
  try { req.email = jwt.verify(token, JWT_SECRET).email; next(); }
  catch { res.status(401).json({ erro: 'Token inválido.' }); }
}

async function uploadImgBB(base64) {
  const form = new FormData();
  form.append('image', base64);
  const res = await axios.post(
    `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
    form, { headers: form.getHeaders(), timeout: 30000 }
  );
  return res.data.data.url;
}

async function adicionarMarcaDagua(imageUrl) {
  try {
    const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imgBuffer = Buffer.from(imgRes.data);
    const meta = await sharp(imgBuffer).metadata();
    const w = meta.width || 800;
    const h = meta.height || 800;

    const fontSize = Math.max(18, Math.floor(w / 12));
    const lineH = Math.floor(fontSize * 2.5);
    const charW = Math.floor(fontSize * 0.6);
    const texto = 'NAO RETIRAR A MARCA DA AGUA   ';
    const textPixelW = texto.length * charW;

    let texts = '';
    const totalRows = Math.ceil((w + h) / lineH) + 6;
    const totalCols = Math.ceil((w + h) / textPixelW) + 4;

    for (let r = 0; r < totalRows; r++) {
      for (let c = 0; c < totalCols; c++) {
        const offset = (r % 2 === 0) ? 0 : Math.floor(textPixelW / 2);
        const x = c * textPixelW + offset - w * 0.5;
        const y = r * lineH - h * 0.3;
        texts += `<text x="${x}" y="${y}" fill="rgba(30,30,30,0.50)" font-family="Arial" font-size="${fontSize}" font-weight="bold" transform="rotate(-25,${x},${y})">${texto}</text>`;
      }
    }

    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" overflow="visible">${texts}</svg>`;

    // Sharp requer SVG com dimensões explícitas para composite
    const svgBuf = Buffer.from(svg);
    const wmPng = await sharp(svgBuf)
      .resize(w, h, { fit: 'contain', background: { r:0, g:0, b:0, alpha:0 } })
      .png()
      .toBuffer()
      .catch(() => svgBuf);

    const result = await sharp(imgBuffer)
      .composite([{ input: svgBuf, blend: 'over' }])
      .jpeg({ quality: 90 })
      .toBuffer();

    return result.toString('base64');
  } catch(e) {
    console.error('Erro marca dagua:', e.message, e.stack);
    return null;
  }
}

// ── AUTH ──────────────────────────────────────────
app.post('/api/auth/cadastro', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !email.includes('@')) return res.json({ erro: 'Email inválido.' });
  if (!senha || senha.length < 6) return res.json({ erro: 'Senha mínimo 6 caracteres.' });
  if (await db.getUsuario(email)) return res.json({ erro: 'Email já cadastrado.' });
  const hash = await bcrypt.hash(senha, 10);
  await db.criarUsuario(uuidv4(), email, hash);
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ sucesso: true, token, creditos: 0 });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.json({ erro: 'Preencha email e senha.' });
  const usuario = await db.getUsuario(email);
  if (!usuario) return res.json({ erro: 'Email não encontrado.' });
  const ok = await bcrypt.compare(senha, usuario.senha);
  if (!ok) return res.json({ erro: 'Senha incorreta.' });
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ sucesso: true, token, creditos: usuario.creditos });
});

app.get('/api/usuario', auth, async (req, res) => {
  const u = await db.getUsuario(req.email);
  res.json(u ? { email: u.email, creditos: u.creditos } : { email: req.email, creditos: 0 });
});

// ── GERAR ARTE ────────────────────────────────────
app.post('/api/gerar', auth, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.json({ sucesso: false, erro: 'Imagem não recebida.' });

    const base64   = image.replace(/^data:image\/\w+;base64,/, '');
    const imageUrl = await uploadImgBB(base64);
    console.log('ImgBB:', imageUrl);

    // Envia para Kie.ai
    const createRes = await axios.post(
      'https://api.kie.ai/api/v1/jobs/createTask',
      { model: 'nano-banana-2', input: { prompt: PROMPT, image_input: [imageUrl], aspect_ratio: 'auto', resolution: '1K', output_format: 'png' } },
      { headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const taskId = createRes.data?.data?.taskId;
    if (!taskId) return res.json({ sucesso: false, erro: 'Erro ao criar tarefa.' });
    console.log('Tarefa:', taskId);

    // Polling
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const poll  = await axios.get(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, { headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` } });
      const data  = poll.data?.data;
      const state = data?.state;
      console.log(`Status (${i+1}): ${state}`);

      if (state === 'success' || state === 'SUCCESS') {
        try {
          const urlFinal = JSON.parse(data.resultJson)?.resultUrls?.[0];
          if (urlFinal) {
            // Gera prévia com marca d'água
            const wmBase64 = await adicionarMarcaDagua(urlFinal);
            let urlPrevia = urlFinal;

            if (wmBase64) {
              urlPrevia = await uploadImgBB(wmBase64);
            }

            // Desconta crédito e salva
            await db.salvarArte(req.email, urlPrevia, urlFinal);

            return res.json({ sucesso: true, urlPrevia });
          }
        } catch(e) { console.log('Erro parse:', e.message); }
      }
      if (state === 'failed' || state === 'FAILED' || state === 'fail') {
        return res.json({ sucesso: false, erro: 'Falha no processamento.' });
      }
    }
    return res.json({ sucesso: false, erro: 'Tempo esgotado. Tente novamente.' });

  } catch (err) {
    console.error('Erro gerar:', err.message);
    console.error('Detalhes:', JSON.stringify(err.response?.data));
    res.json({ sucesso: false, erro: err.message });
  }
});

// ── ARTES DO USUÁRIO ──────────────────────────────
app.get('/api/artes', auth, async (req, res) => {
  const artes = await db.getArtes(req.email);
  res.json(artes);
});

// ── PAGAMENTO MP ──────────────────────────────────
app.post('/api/pagamento/criar', auth, async (req, res) => {
  const { plano } = req.body;
  const p = PLANOS[plano];
  if (!p) return res.json({ erro: 'Plano inválido.' });

  try {
    const response = await axios.post(
      'https://api.mercadopago.com/v1/payments',
      {
        transaction_amount: p.preco,
        description: `DesenhaArte — ${p.nome}`,
        payment_method_id: 'pix',
        payer: { email: req.email },
        metadata: { email: req.email, plano, creditos: p.creditos },
        notification_url: `${BASE_URL}/api/pagamento/webhook`,
      },
      {
        headers: {
          Authorization: `Bearer ${MP_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': uuidv4(),
        },
      }
    );

    const pix = response.data.point_of_interaction?.transaction_data;
    res.json({
      sucesso: true,
      pixCopiaECola: pix?.qr_code,
      qrCodeBase64: pix?.qr_code_base64,
      paymentId: response.data.id,
      valor: p.preco,
      plano: p.nome,
      creditos: p.creditos,
    });
  } catch (err) {
    console.error('Erro MP:', err.response?.data || err.message);
    res.json({ erro: 'Erro ao gerar PIX.' });
  }
});

app.get('/api/pagamento/status/:id', auth, async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.mercadopago.com/v1/payments/${req.params.id}`,
      { headers: { Authorization: `Bearer ${MP_TOKEN}` } }
    );
    res.json({ sucesso: response.data.status === 'approved', status: response.data.status });
  } catch (err) {
    res.json({ erro: err.message });
  }
});

app.post('/api/pagamento/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type === 'payment' && data?.id) {
      const jaProcessado = await db.pagamentoJaProcessado(String(data.id));
      if (jaProcessado) return res.sendStatus(200);

      const response = await axios.get(
        `https://api.mercadopago.com/v1/payments/${data.id}`,
        { headers: { Authorization: `Bearer ${MP_TOKEN}` } }
      );
      const payment = response.data;
      console.log('Webhook MP:', payment.status, payment.payer?.email);

      if (payment.status === 'approved') {
        await db.marcarPagamentoProcessado(String(data.id));
        const email    = payment.metadata?.email || payment.payer?.email;
        const creditos = parseInt(payment.metadata?.creditos || 0);
        if (email && creditos > 0) {
          const u = await db.getUsuario(email);
          if (!u) {
            const hash = await bcrypt.hash(Math.random().toString(36), 10);
            await db.criarUsuario(uuidv4(), email, hash);
          }
          const novo = await db.adicionarCreditos(email, creditos);
          console.log(`+${creditos} créditos para ${email} | Total: ${novo}`);
        }
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Erro webhook:', err.message);
    res.sendStatus(200);
  }
});

// ── ADMIN ─────────────────────────────────────────
app.get('/api/admin/addme', async (req, res) => {
  const { secret, email, creditos } = req.query;
  if (secret !== ADMIN_SECRET) return res.send('❌ Sem permissão.');
  if (!email || !creditos) return res.send('❌ Parâmetros inválidos.');
  const u = await db.getUsuario(email);
  if (!u) return res.send('❌ Usuário não encontrado.');
  const novo = await db.adicionarCreditos(email, parseInt(creditos));
  res.send(`✅ +${creditos} créditos para ${email}. Saldo: ${novo}`);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DesenhaArte rodando em http://localhost:${PORT}`));
