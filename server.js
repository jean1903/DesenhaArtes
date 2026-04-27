require('dotenv').config();
const express  = require('express');
const axios    = require('axios');
const path     = require('path');
const FormData = require('form-data');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const sharp    = require('sharp');
const Jimp     = require('jimp');
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

    // Carrega imagem com Jimp
    const img = await Jimp.read(imgBuffer);
    const w = img.getWidth();
    const h = img.getHeight();

    // Carrega fonte embutida do Jimp (nao precisa de fontes do sistema)
    const fontLarge  = await Jimp.loadFont(Jimp.FONT_SANS_64_BLACK);
    const fontMedium = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

    const texto = 'NAO RETIRE A MARCA DAGUA';
    const textW64 = Jimp.measureText(fontLarge, texto);
    const textH64 = Jimp.measureTextHeight(fontLarge, texto, 9999);
    const textW32 = Jimp.measureText(fontMedium, texto);

    // Cria overlay transparente
    const overlay = new Jimp(w, h, 0x00000000);

    // Pinta texto em grade diagonal com fonte media
    const stepX = textW32 + 40;
    const stepY = 90;
    for (let y = -stepY; y < h + stepY; y += stepY) {
      for (let x = -stepX; x < w + stepX; x += stepX) {
        const ox = (Math.floor(y / stepY) % 2 === 0) ? x : x + stepX / 2;
        overlay.print(fontMedium, ox, y, { text: texto, alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT }, w, h);
      }
    }

    // Linha central grande
    const centerY = Math.floor(h / 2 - textH64 / 2);
    const centerX = Math.floor((w - textW64) / 2);
    overlay.print(fontLarge, centerX, centerY, texto);

    // Define opacidade do overlay
    overlay.opacity(0.55);

    // Composita overlay na imagem original
    img.composite(overlay, 0, 0, {
      mode: Jimp.BLEND_SOURCE_OVER,
      opacitySource: 0.55,
      opacityDest: 1,
    });

    const resultBuf = await img.getBufferAsync(Jimp.MIME_JPEG);
    return resultBuf.toString('base64');
  } catch(e) {
    console.error('Erro marca dagua Jimp:', e.message);
    return null;
  }
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

    // Estrategia: criar multiplos tiles PNG com stripes diagonais escuras
    // e compositar sobre a imagem - sem depender de fontes
    
    const stripe = Math.floor(w / 8);  // largura da faixa diagonal
    const gap    = Math.floor(w / 5);  // espaco entre faixas
    const period = stripe + gap;

    // Cria buffer RGBA com faixas diagonais
    const wmData = Buffer.alloc(w * h * 4, 0);
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const diag = ((x + y) % period + period) % period;
        if (diag < stripe) {
          const idx = (y * w + x) * 4;
          const fade = diag < stripe / 2 
            ? diag / (stripe / 2) 
            : (stripe - diag) / (stripe / 2);
          const alpha = Math.floor(130 * fade);
          wmData[idx]   = 15;
          wmData[idx+1] = 15;
          wmData[idx+2] = 15;
          wmData[idx+3] = alpha;
        }
      }
    }

    const wmPng = await sharp(wmData, {
      raw: { width: w, height: h, channels: 4 }
    }).png().toBuffer();

    // Faixa central solida (linha grossa no meio como na imagem)
    const barH  = Math.floor(h * 0.07);
    const barY  = Math.floor(h / 2 - barH / 2);
    const barData = Buffer.alloc(w * barH * 4);
    for (let i = 0; i < w * barH; i++) {
      barData[i * 4]     = 10;
      barData[i * 4 + 1] = 10;
      barData[i * 4 + 2] = 10;
      barData[i * 4 + 3] = 180;
    }
    const barPng = await sharp(barData, {
      raw: { width: w, height: barH, channels: 4 }
    }).png().toBuffer();

    const result = await sharp(imgBuffer)
      .composite([
        { input: wmPng, blend: 'over' },
        { input: barPng, top: barY, left: 0, blend: 'over' },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();

    return result.toString('base64');
  } catch(e) {
    console.error('Erro marca dagua:', e.message);
    return null;
  }
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

    // Cria canvas com texto real
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');

    // Fundo transparente
    ctx.clearRect(0, 0, w, h);

    const fontSize = Math.max(24, Math.floor(w / 13));
    const texto = 'NAO RETIRE A MARCA DAGUA';
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.fillStyle = 'rgba(20, 20, 20, 0.52)';

    const lineH  = fontSize * 3.2;
    const textW  = ctx.measureText(texto).width + fontSize * 2;
    const rows   = Math.ceil((w + h) / lineH) + 6;
    const cols   = Math.ceil((w + h) / textW) + 4;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 6); // -30 graus
    ctx.translate(-w, -h);

    for (let r = -2; r < rows + 2; r++) {
      for (let c = -2; c < cols + 2; c++) {
        const x = c * textW + (r % 2 === 0 ? 0 : textW / 2);
        const y = r * lineH;
        ctx.fillText(texto, x, y);
      }
    }

    // Texto central grande
    const bigSize = Math.floor(w / 9);
    ctx.font = `900 ${bigSize}px Arial`;
    ctx.fillStyle = 'rgba(10, 10, 10, 0.60)';
    ctx.textAlign = 'center';
    ctx.fillText(texto, w, h);

    ctx.restore();

    const wmBuffer = canvas.toBuffer('image/png');

    const result = await sharp(imgBuffer)
      .composite([{ input: wmBuffer, blend: 'over' }])
      .jpeg({ quality: 90 })
      .toBuffer();

    return result.toString('base64');
  } catch(e) {
    console.error('Erro marca dagua:', e.message);
    return null;
  }
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

    // Cria marca dagua como imagem PNG usando sharp raw
    // Usa multiplas linhas diagonais de pixels brancos/cinzas
    const tileSize = 200;
    const stripeW  = 40;

    // Cria tile com stripes diagonais
    const tileData = Buffer.alloc(tileSize * tileSize * 4, 0); // RGBA transparente
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const diag = (x + y) % tileSize;
        if (diag < stripeW) {
          const idx = (y * tileSize + x) * 4;
          const alpha = Math.floor(120 * (1 - diag / stripeW)); // fade
          tileData[idx]   = 30;   // R
          tileData[idx+1] = 30;   // G
          tileData[idx+2] = 30;   // B
          tileData[idx+3] = alpha; // A
        }
      }
    }

    const tilePng = await sharp(tileData, {
      raw: { width: tileSize, height: tileSize, channels: 4 }
    }).png().toBuffer();

    // Repete o tile para cobrir a imagem toda
    const cols = Math.ceil(w / tileSize) + 1;
    const rows = Math.ceil(h / tileSize) + 1;
    const composites = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        composites.push({
          input: tilePng,
          top: r * tileSize,
          left: c * tileSize,
          blend: 'over'
        });
      }
    }

    // Adiciona linha central grossa
    const lineH = Math.floor(h * 0.08);
    const lineY = Math.floor(h / 2 - lineH / 2);
    const lineData = Buffer.alloc(w * lineH * 4);
    for (let i = 0; i < w * lineH * 4; i += 4) {
      lineData[i]   = 20;
      lineData[i+1] = 20;
      lineData[i+2] = 20;
      lineData[i+3] = 160;
    }
    const linePng = await sharp(lineData, {
      raw: { width: w, height: lineH, channels: 4 }
    }).png().toBuffer();

    composites.push({ input: linePng, top: lineY, left: 0, blend: 'over' });

    const result = await sharp(imgBuffer)
      .composite(composites)
      .jpeg({ quality: 88 })
      .toBuffer();

    return result.toString('base64');
  } catch(e) {
    console.error('Erro marca dagua:', e.message);
    return null;
  }
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

    const fontSize = Math.max(22, Math.floor(w / 13));
    const texto = 'NAO RETIRE A MARCA DAGUA';
    const lineH = Math.floor(fontSize * 3.5);
    const colW  = Math.floor(fontSize * 16);

    const rows = Math.ceil((w + h) / lineH) + 6;
    const cols = Math.ceil((w + h) / colW) + 4;

    let texts = '';
    for (let r = -3; r < rows; r++) {
      for (let c = -3; c < cols; c++) {
        const x = c * colW + (r % 2 === 0 ? 0 : colW / 2) - w * 0.4;
        const y = r * lineH - h * 0.2;
        texts += `<text
          x="${x}" y="${y}"
          font-family="Arial"
          font-size="${fontSize}"
          font-weight="bold"
          fill="#1a1a1a"
          fill-opacity="0.55"
          transform="rotate(-30 ${x} ${y})"
        >${texto}</text>`;
      }
    }

    // Linha central grande
    const bigSize = Math.floor(w / 9);
    texts += `<text
      x="${w/2}" y="${h/2}"
      font-family="Arial"
      font-size="${bigSize}"
      font-weight="bold"
      fill="#0a0a0a"
      fill-opacity="0.60"
      text-anchor="middle"
      dominant-baseline="middle"
      transform="rotate(-30 ${w/2} ${h/2})"
    >${texto}</text>`;

    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${w}" height="${h}" fill="none"/>
      ${texts}
    </svg>`;

    const svgBuf = Buffer.from(svg, 'utf8');

    const result = await sharp(imgBuffer)
      .composite([{ input: svgBuf, blend: 'over' }])
      .jpeg({ quality: 90 })
      .toBuffer();

    return result.toString('base64');
  } catch(e) {
    console.error('Erro marca dagua:', e.message);
    console.error(e.stack);
    return null;
  }
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

    // Configuracoes identicas ao modelo
    const fontSize = Math.max(20, Math.floor(w / 16));
    const angle = -30;
    const texto = "NÃO RETIRE A MARCA D’ÁGUA";
    const lockIcon = '🔒';
    const lineSpacing = Math.floor(fontSize * 3.2);
    const colSpacing = Math.floor(fontSize * 14);

    // Calcula quantas linhas e colunas precisamos
    const diag = Math.ceil(Math.sqrt(w*w + h*h));
    const numRows = Math.ceil(diag / lineSpacing) + 6;
    const numCols = Math.ceil(diag / colSpacing) + 4;
    const offset = Math.floor(diag / 2);

    let elements = '';

    // Linhas de texto repetidas em diagonal (estilo tracejado)
    for (let r = -3; r < numRows; r++) {
      for (let c = -3; c < numCols; c++) {
        const x = c * colSpacing - offset + (r % 2 === 0 ? 0 : colSpacing / 2);
        const y = r * lineSpacing - offset;
        // Texto principal
        elements += `<text x="${x}" y="${y}" 
          font-family="Arial, sans-serif" 
          font-size="${fontSize}" 
          font-weight="bold" 
          fill="rgba(20,20,20,0.45)"
          transform="rotate(${angle}, ${x}, ${y})"
        >${texto}</text>`;
        // Ícone de cadeado entre textos
        const lx = x + colSpacing * 0.5;
        const ly = y + lineSpacing * 0.5;
        elements += `<text x="${lx}" y="${ly}"
          font-size="${Math.floor(fontSize * 0.9)}"
          fill="rgba(20,20,20,0.35)"
          transform="rotate(${angle}, ${lx}, ${ly})"
        >${lockIcon}</text>`;
      }
    }

    // Linha central grossa (como na imagem)
    const cx = w / 2;
    const cy = h / 2;
    const bigFontSize = Math.floor(w / 8);
    elements += `<text x="${cx}" y="${cy}"
      font-family="Arial Black, Arial, sans-serif"
      font-size="${bigFontSize}"
      font-weight="900"
      fill="rgba(10,10,10,0.55)"
      text-anchor="middle"
      dominant-baseline="middle"
      transform="rotate(${angle}, ${cx}, ${cy})"
    >${texto}</text>`;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${w}" height="${h}" fill="none"/>
  ${elements}
</svg>`;

    const svgBuf = Buffer.from(svg, 'utf8');

    // Renderiza SVG para PNG transparente com sharp
    const wmPng = await sharp(svgBuf)
      .png()
      .toBuffer();

    const result = await sharp(imgBuffer)
      .composite([{ input: wmPng, blend: 'over' }])
      .jpeg({ quality: 90 })
      .toBuffer();

    return result.toString('base64');
  } catch(e) {
    console.error('Erro marca dagua:', e.message);
    console.error(e.stack);
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
