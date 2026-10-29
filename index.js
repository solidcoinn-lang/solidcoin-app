require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const crypto = require('crypto');
const fs = require('fs');
const EfiPay = require('sdk-node-apis-efi');
const { OAuth2Client } = require('google-auth-library'); 

// =========================================================================
// --- INTEGRAÇÃO WEB3 MINIPAY (REDE CELO - USDC) ---
// =========================================================================
let celoProvider = null;
let celoWallet = null;
let usdcContract = null;

try {
    const { ethers } = require('ethers');
    celoProvider = new ethers.JsonRpcProvider('https://forno.celo.org');
    
    if (process.env.MINIPAY_SEED_PHRASE) {
        // Conecta usando as 12 palavras-passe da Opera MiniPay
        celoWallet = ethers.Wallet.fromPhrase(process.env.MINIPAY_SEED_PHRASE).connect(celoProvider);
    } else if (process.env.MINIPAY_PRIVATE_KEY) {
        celoWallet = new ethers.Wallet(process.env.MINIPAY_PRIVATE_KEY, celoProvider);
    }

    if (celoWallet) {
        // Contrato Oficial do USDC na Celo
        const USDC_ADDRESS = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
        const erc20Abi = ["function transfer(address to, uint256 value) public returns (bool)"];
        usdcContract = new ethers.Contract(USDC_ADDRESS, erc20Abi, celoWallet);
        console.log("✅ Carteira MiniPay (Celo USDC) conectada para pagamentos automáticos!");
    } else {
        console.warn("⚠️ AVISO: MINIPAY_SEED_PHRASE não encontrada nas variáveis de ambiente.");
    }
} catch (error) {
    console.error("⚠️ Aviso: Biblioteca 'ethers' não instalada ou erro ao configurar carteira MiniPay.");
}

// =========================================================================
// --- INTEGRAÇÃO EFÍ (API PIX) E GOOGLE AUTH ---
// =========================================================================

const isSandbox = process.env.EFI_ENV !== 'producao';
console.log(`🌍 MODO EFÍ: ${isSandbox ? 'HOMOLOGAÇÃO (TESTES)' : 'PRODUÇÃO (REAL)'}`);

let googleClient = null;
if (process.env.GOOGLE_CLIENT_ID) {
    googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    console.log("✅ API Login do Google ativada!");
} else {
    console.warn("⚠️ AVISO: GOOGLE_CLIENT_ID não encontrado nas variáveis de ambiente.");
}

let certPathPF = path.join(__dirname, 'certificado.p12');
if (process.env.EFI_CERT_BASE64) {
    certPathPF = path.join(__dirname, 'certificado_render_pf.p12');
    try { fs.writeFileSync(certPathPF, Buffer.from(process.env.EFI_CERT_BASE64, 'base64')); } catch (err) {}
}

const efipayPF = new EfiPay({
    sandbox: isSandbox, client_id: process.env.EFI_CLIENT_ID, client_secret: process.env.EFI_CLIENT_SECRET, certificate: certPathPF
});

let certPathPJ = path.join(__dirname, 'certificado_pj.p12'); 
if (process.env.EFI_CERT_BASE64_PJ) {
    certPathPJ = path.join(__dirname, 'certificado_render_pj.p12');
    try { fs.writeFileSync(certPathPJ, Buffer.from(process.env.EFI_CERT_BASE64_PJ, 'base64')); } catch (err) {}
}

let efipayPJ = null;
if (process.env.EFI_CLIENT_ID_PJ && process.env.EFI_CLIENT_SECRET_PJ && process.env.EFI_CERT_BASE64_PJ) {
    efipayPJ = new EfiPay({
        sandbox: isSandbox, client_id: process.env.EFI_CLIENT_ID_PJ, client_secret: process.env.EFI_CLIENT_SECRET_PJ, certificate: certPathPJ
    });
}

// =========================================================================

const User = require('./models/User');
const Product = require('./models/Product');
const Transaction = require('./models/Transaction');
const Withdrawal = require('./models/Withdrawal');
const GiftCardOrder = require('./models/GiftCardOrder');
const RechargeOrder = require('./models/RechargeOrder'); 
const SolidCoinGiftCard = require('./models/SolidCoinGiftCard');
const Deposit = require('./models/Deposit');
const SocioOrder = require('./models/SocioOrder'); 
const SystemSettings = require('./models/SystemSettings'); 
const PixWithdrawal = require('./models/PixWithdrawal');

const investimentosRoutes = require('./routes/investimentos'); 

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = "solidcoinn@gmail.com";

const STAKING_REWARD_RATE_MONTHLY = 0.05; 
const WHALE_THRESHOLD = 1000000; 
const WHALE_YIELD_PER_DAY = 200;

const PLANOS_SOCIO = {
    "Socio SolidCoin para Todos": { valorReais: 1, sc: 500, imagemUrl: "https://i.postimg.cc/QxzG1q50/Design-sem-nome.png" },
    "Iron": { valorReais: 5, sc: 3025, imagemUrl: "https://i.postimg.cc/9MwF9J8R/iron-plan.png" },
    "Bronze": { valorReais: 10, sc: 6325, imagemUrl: "https://i.postimg.cc/Z5F1fF2n/bronze-plan.png" },
    "Prata": { valorReais: 20, sc: 13200, imagemUrl: "https://i.postimg.cc/hP0Zc1p9/silver-plan.png" },
    "Ouro": { valorReais: 50, sc: 34375, imagemUrl: "https://i.postimg.cc/k4T8YnS2/gold-plan.png" },
    "Diamante": { valorReais: 100, sc: 71500, imagemUrl: "https://i.postimg.cc/mZhTbqQ4/diamond-plan.png" }
};

const ImagemConfigSchema = new mongoose.Schema({
    chave: { type: String, required: true, unique: true },
    url: { type: String, default: '' },
    nomeExibicao: { type: String, default: '' }
});
const ImagemConfig = mongoose.models.ImagemConfig || mongoose.model('ImagemConfig', ImagemConfigSchema);

const NfcOrderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    nomeUsuario: String, emailUsuario: String, enderecoEntrega: String, nfcToken: String,
    status: { type: String, default: 'Pendente' }, data: { type: Date, default: Date.now }
});
const NfcOrder = mongoose.models.NfcOrder || mongoose.model('NfcOrder', NfcOrderSchema);

// --- NOVO MODELO: LINKS DE REFERÊNCIA DO ADM ---
const ReferralLinkSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    descricao: { type: String, default: '' },
    url: { type: String, required: true },
    data: { type: Date, default: Date.now }
});
const ReferralLink = mongoose.models.ReferralLink || mongoose.model('ReferralLink', ReferralLinkSchema);

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => { setupInicial(); }).catch(err => console.error(err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'solidcoin-efi-secret-2026', resave: false, saveUninitialized: false }));

function checkAuthenticated(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ sucesso: false, mensagem: "Acesso não autorizado." });
}

function isAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.email === ADMIN_EMAIL) return next();
    res.status(403).send('Acesso negado.');
}

async function getSCRate() {
    let settings = await SystemSettings.findOne();
    if (!settings) settings = await new SystemSettings({ scPorReal: 500 }).save(); 
    return settings.scPorReal;
}

function normalizarChavePix(chave, tipo = '') {
    let c = String(chave || '').trim().replace(/^['"]|['"]$/g, '');
    if (c.includes('@')) return c.toLowerCase();
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(c)) return c.toLowerCase();
    let nums = c.replace(/\D/g, '');
    if (tipo.toLowerCase().includes('telefone') || tipo.toLowerCase().includes('celular') || c.startsWith('+55')) {
        if (nums.length === 11) return `+55${nums}`;
        if (nums.length === 13 && nums.startsWith('55')) return `+${nums}`;
        return `+55${nums}`;
    }
    return nums;
}

async function calcularLimiteSaque(userId, currentSaldo, userEmail) {
    if (userEmail === ADMIN_EMAIL) return currentSaldo;
    const txs = await Transaction.find({ userId: userId });
    let limiteBruto = 0; let saquesEfetuados = 0;

    const tiposLivres = [ 'Depósito Aprovado', 'Transferência Recebida', 'Venda no Marketplace', 'Recompensa de Staking', 'Rendimento Automático', 'Bônus de Indicação', 'Comissão de Indicação', 'Comissão de Indicação (Sócio)', 'Bônus de Boas-Vindas', 'Resgate Gift Card SC', 'Estorno Saque Pix', 'Estorno de Saque', 'Recompensa Monlix' ];

    const agora = Date.now();
    txs.forEach(tx => {
        if (tiposLivres.includes(tx.tipo)) {
            limiteBruto += tx.valor;
        } else if (tx.tipo === 'Assinatura Sócio SolidCoin') {
            const mesesPassados = Math.floor(((agora - new Date(tx.data).getTime()) / (1000 * 60 * 60 * 24)) / 30);
            if (mesesPassados > 0) limiteBruto += (tx.valor * Math.min(mesesPassados * 0.25, 1.0));
        } else if (tx.tipo === 'Saque Cripto Solicitado' || tx.tipo === 'Saque Pix Solicitado' || tx.tipo === 'Saque Pix Automático') {
            saquesEfetuados += Math.abs(tx.valor);
        }
    });

    return Math.max(0, Math.min(currentSaldo, limiteBruto - saquesEfetuados));
}

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.post('/cadastrar', async (req, res) => {
    const { nome, email, senha, codigoIndicacao } = req.body;
    try {
        if (await User.findOne({ email })) return res.status(409).send("Email já cadastrado.");
        const admin = await User.findOne({ email: ADMIN_EMAIL });
        let referrer = null;
        if (codigoIndicacao) referrer = await User.findOne({ codigoIndicacao: codigoIndicacao.toUpperCase() });

        const senhaHash = await bcrypt.hash(senha, 10);
        let novoCodigoUnico; let isCodeUnique = false;
        while (!isCodeUnique) {
            novoCodigoUnico = crypto.randomBytes(3).toString('hex').toUpperCase();
            if (!(await User.findOne({ codigoIndicacao: novoCodigoUnico }))) isCodeUnique = true;
        }

        let saldoInicial = 0; let indicadoPorId = null;
        if (referrer && admin && admin.saldo >= 500) {
            saldoInicial = 250; indicadoPorId = referrer._id;
            referrer.saldo += 250; admin.saldo -= 500; 
            await Promise.all([ referrer.save(), admin.save(), new Transaction({ userId: referrer._id, tipo: 'Bônus de Indicação', descricao: `Convite ${nome}`, valor: 250 }).save(), new Transaction({ userId: admin._id, tipo: 'Pagamento Indicação', descricao: `Bônus ${referrer.nome} e ${nome}`, valor: -500 }).save() ]);
        }

        const novoUsuario = new User({ nome, email, senha: senhaHash, saldo: saldoInicial, codigoIndicacao: novoCodigoUnico, indicadoPor: indicadoPorId });
        await novoUsuario.save();

        if (saldoInicial > 0) await new Transaction({ userId: novoUsuario._id, tipo: 'Bônus de Boas-Vindas', descricao: `Código ${referrer.nome}`, valor: 250 }).save();
        res.redirect('/index.html?cadastro=sucesso');
    } catch (error) { res.status(500).send("Erro."); }
});

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(senha, user.senha))) return res.status(401).send("Inválido."); 
        req.session.user = { id: user._id, nome: user.nome, email: user.email };
        res.redirect('/dashboard.html');
    } catch (error) { res.status(500).send("Erro."); }
});

app.post('/logout', checkAuthenticated, (req, res) => {
    req.session.destroy(err => { res.clearCookie('connect.sid'); res.json({ sucesso: true }); });
});

// =========================================================================
// ROTA: LOGIN E CADASTRO VIA GOOGLE
// =========================================================================
app.post('/api/auth/google', async (req, res) => {
    if (!googleClient) return res.status(500).json({ sucesso: false, mensagem: "Google Login não configurado no servidor (Falta GOOGLE_CLIENT_ID)." });
    
    const { credential, codigoIndicacao } = req.body;
    if (!credential) return res.status(400).json({ sucesso: false, mensagem: "Token inválido." });

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const email = payload.email;
        const nome = payload.name;
        
        let user = await User.findOne({ email });
        
        if (!user) {
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            let referrer = null;
            if (codigoIndicacao) referrer = await User.findOne({ codigoIndicacao: codigoIndicacao.toUpperCase() });

            const senhaHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
            
            let novoCodigoUnico; let isCodeUnique = false;
            while (!isCodeUnique) {
                novoCodigoUnico = crypto.randomBytes(3).toString('hex').toUpperCase();
                if (!(await User.findOne({ codigoIndicacao: novoCodigoUnico }))) isCodeUnique = true;
            }

            let saldoInicial = 0; let indicadoPorId = null;
            if (referrer && admin && admin.saldo >= 500) {
                saldoInicial = 250; indicadoPorId = referrer._id;
                referrer.saldo += 250; admin.saldo -= 500; 
                await Promise.all([
                    referrer.save(), admin.save(),
                    new Transaction({ userId: referrer._id, tipo: 'Bônus de Indicação', descricao: `Você convidou ${nome} (Google)`, valor: 250 }).save(),
                    new Transaction({ userId: admin._id, tipo: 'Pagamento Indicação', descricao: `Bônus para ${referrer.nome}`, valor: -500 }).save()
                ]);
            }

            user = new User({ nome, email, senha: senhaHash, saldo: saldoInicial, codigoIndicacao: novoCodigoUnico, indicadoPor: indicadoPorId });
            await user.save();

            if (saldoInicial > 0) {
                await new Transaction({ userId: user._id, tipo: 'Bônus de Boas-Vindas', descricao: `Código de indicação`, valor: 250 }).save();
            }
        }
        
        req.session.user = { id: user._id, nome: user.nome, email: user.email };
        res.json({ sucesso: true, redirecionar: '/dashboard.html' });
        
    } catch (error) {
        console.error("Erro no Google Auth:", error);
        res.status(401).json({ sucesso: false, mensagem: "Erro ao validar conta do Google. Tente novamente." });
    }
});

app.get('/api/dados-dashboard', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const produtos = await Product.find({});
        const scRate = await getSCRate();

        if (!user.codigoIndicacao) { user.codigoIndicacao = crypto.randomBytes(3).toString('hex').toUpperCase(); await user.save(); }
        if (user.statusSocio === 'Ativo' && user.vencimentoSocio && new Date() > new Date(user.vencimentoSocio)) { user.statusSocio = 'Inadimplente'; await user.save(); }

        const diasPassados = (Date.now() - new Date(user.lastYieldApplied)) / (1000 * 60 * 60 * 24);
        if(user.saldo >= WHALE_THRESHOLD && diasPassados >= 1 && user.email !== ADMIN_EMAIL) {
            const diasInteiros = Math.floor(diasPassados);
            const rendimentoGanho = diasInteiros * WHALE_YIELD_PER_DAY;
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            if (admin && admin.saldo >= rendimentoGanho) {
                admin.saldo -= rendimentoGanho; user.saldo += rendimentoGanho; user.lastYieldApplied = Date.now();
                await Promise.all([user.save(), admin.save(), new Transaction({ userId: user._id, tipo: 'Rendimento Automático', descricao: `Rendimento de ${diasInteiros} dia(s)`, valor: rendimentoGanho }).save()]);
            }
        }

        const imagensConfig = await ImagemConfig.find({});
        let planosDinamicos = JSON.parse(JSON.stringify(PLANOS_SOCIO));
        
        imagensConfig.forEach(img => {
            if (img.chave.startsWith('plano_') && img.url) {
                const planoNome = img.chave.replace('plano_', '');
                if (planosDinamicos[planoNome]) {
                    planosDinamicos[planoNome].imagemUrl = img.url;
                }
            }
        });

        res.json({
            sucesso: true, scRate: scRate,
            planosImagens: planosDinamicos, 
            usuario: { 
                nome: user.nome, saldo: user.saldo, stakedAmount: user.stakedAmount, canUnstakeAt: user.canUnstakeAt, 
                solanaWallet: user.solanaWallet, tronWallet: user.tronWallet, minipayWallet: user.minipayWallet,
                isAdmin: user.email === ADMIN_EMAIL, statusSocio: user.statusSocio, planoSocio: user.planoSocio, 
                vencimentoSocio: user.vencimentoSocio, codigoIndicacao: user.codigoIndicacao, 
                limiteDeSaque: await calcularLimiteSaque(user._id, user.saldo, user.email), nfcToken: user.nfcToken || '',
                jaUsouCodigo: !!user.indicadoPor 
            },
            marketplace: produtos.map(p => ({ id: p._id, nome: p.nome, preco: p.preco, imagemUrl: p.imagemUrl, categoria: p.categoria || 'Cédulas' }))
        });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

// =========================================================================
// --- ROTAS DE LINKS DE REFERÊNCIA (COBRANÇA DE 10 SC REVERTIDA AO CEO) ---
// =========================================================================
app.post('/api/links-referencia/acessar', checkAuthenticated, async (req, res) => {
    try {
        const TAXA_ACESSO = 10;
        const user = await User.findById(req.session.user.id);
        
        if (!user) return res.status(404).json({ sucesso: false, mensagem: "Usuário não encontrado." });
        if (user.saldo < TAXA_ACESSO) {
            return res.status(400).json({ sucesso: false, mensagem: `Saldo insuficiente! Você precisa de ${TAXA_ACESSO} SolidCoins para abrir a página de links.` });
        }

        // Desconta do usuário e envia sempre para o CEO
        if (user.email !== ADMIN_EMAIL) {
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            user.saldo -= TAXA_ACESSO;
            
            const promises = [
                user.save(),
                new Transaction({ userId: user._id, tipo: 'Acesso Página de Links', descricao: 'Desbloqueio de Links de Referência', valor: -TAXA_ACESSO }).save()
            ];

            if (admin) {
                admin.saldo += TAXA_ACESSO;
                promises.push(admin.save());
                promises.push(new Transaction({ userId: admin._id, tipo: 'Recebimento Acesso Links', descricao: `Pago por ${user.nome}`, valor: TAXA_ACESSO }).save());
            }

            await Promise.all(promises);
        } else {
            // Caso o próprio CEO esteja testando, registra no extrato sem duplicar objeto
            await new Transaction({ userId: user._id, tipo: 'Teste Acesso Links (CEO)', descricao: 'Acesso administrativo aos links', valor: 0 }).save();
        }

        const links = await ReferralLink.find({}).sort({ data: -1 });
        res.json({ 
            sucesso: true, 
            mensagem: "✅ Acesso liberado! Foram descontadas 10 SolidCoins.", 
            novoSaldo: user.saldo, 
            links: links 
        });
    } catch (error) {
        res.status(500).json({ sucesso: false, mensagem: "Erro ao liberar página de links." });
    }
});

app.get('/api/admin/links-referencia', isAdmin, async (req, res) => {
    try {
        const links = await ReferralLink.find({}).sort({ data: -1 });
        res.json({ sucesso: true, links });
    } catch (error) {
        res.status(500).json({ sucesso: false, mensagem: "Erro ao listar links." });
    }
});

app.post('/api/admin/links-referencia/adicionar', isAdmin, async (req, res) => {
    try {
        const { titulo, descricao, url } = req.body;
        if (!titulo || !url || !url.startsWith('http')) {
            return res.status(400).json({ sucesso: false, mensagem: "Preencha o título e uma URL válida (iniciando com http:// ou https://)." });
        }
        await new ReferralLink({ titulo: titulo.trim(), descricao: (descricao || '').trim(), url: url.trim() }).save();
        res.json({ sucesso: true, mensagem: "✅ Link de referência cadastrado com sucesso!" });
    } catch (error) {
        res.status(500).json({ sucesso: false, mensagem: "Erro ao cadastrar link." });
    }
});

app.delete('/api/admin/links-referencia/excluir/:id', isAdmin, async (req, res) => {
    try {
        await ReferralLink.findByIdAndDelete(req.params.id);
        res.json({ sucesso: true, mensagem: "🗑️ Link removido com sucesso!" });
    } catch (error) {
        res.status(500).json({ sucesso: false, mensagem: "Erro ao remover link." });
    }
});

// =========================================================================

app.post('/api/indicacao/resgatar', checkAuthenticated, async (req, res) => {
    try {
        const { codigo } = req.body;
        const user = await User.findById(req.session.user.id);
        if (user.indicadoPor || user.codigoIndicacao === codigo.toUpperCase()) return res.status(400).json({ sucesso: false });
        const referrer = await User.findOne({ codigoIndicacao: codigo.toUpperCase() });
        const admin = await User.findOne({ email: ADMIN_EMAIL });
        if (!referrer || !admin || admin.saldo < 500) return res.status(400).json({ sucesso: false });

        user.indicadoPor = referrer._id; user.saldo += 250; referrer.saldo += 250; admin.saldo -= 500;
        await Promise.all([ user.save(), referrer.save(), admin.save(), new Transaction({ userId: user._id, tipo: 'Bônus de Boas-Vindas', descricao: `Código de ${referrer.nome}`, valor: 250 }).save(), new Transaction({ userId: referrer._id, tipo: 'Bônus de Indicação', descricao: `Você convidou ${user.nome}`, valor: 250 }).save(), new Transaction({ userId: admin._id, tipo: 'Pagamento Indicação', descricao: `Para ${referrer.nome} e ${user.nome}`, valor: -500 }).save() ]);
        res.json({ sucesso: true, novoSaldo: user.saldo });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/nfc/gerar-meu-token', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        if (!user.nfcToken || user.nfcToken === '') {
            user.nfcToken = 'SOLID-' + crypto.randomBytes(4).toString('hex').toUpperCase();
            await user.save();
        }
        res.json({ sucesso: true, token: user.nfcToken, mensagem: "Seu Token NFC foi gerado!" });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/nfc/solicitar-cartao', checkAuthenticated, async (req, res) => {
    try {
        const { endereco } = req.body;
        if (!endereco || endereco.trim().length < 5) return res.status(400).json({ sucesso: false, mensagem: "Endereço inválido." });

        const CUSTO_CARTAO = 1600;
        const user = await User.findById(req.session.user.id);
        const admin = await User.findOne({ email: ADMIN_EMAIL });

        if (user.saldo < CUSTO_CARTAO) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });

        const tokenExclusivo = 'SOLID-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        user.saldo -= CUSTO_CARTAO; admin.saldo += CUSTO_CARTAO; user.nfcToken = tokenExclusivo; 

        const novoPedido = new NfcOrder({ userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, enderecoEntrega: endereco, nfcToken: tokenExclusivo, status: 'Pendente' });

        await Promise.all([
            user.save(), admin.save(), novoPedido.save(),
            new Transaction({ userId: user._id, tipo: 'Emissão Cartão NFC', descricao: `Cartão SolidCoin Exclusivo`, valor: -CUSTO_CARTAO }).save(),
            new Transaction({ userId: admin._id, tipo: 'Venda Cartão NFC', descricao: `Para ${user.nome}`, valor: CUSTO_CARTAO }).save()
        ]);
        res.json({ sucesso: true, mensagem: "Cartão Solicitado com Sucesso!", novoSaldo: user.saldo });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/nfc/transferir-aproximacao', checkAuthenticated, async (req, res) => {
    try {
        const { nfcTokenDestino, valor } = req.body;
        const valorNum = parseFloat(valor);
        if (!nfcTokenDestino || !valorNum || valorNum <= 0) return res.status(400).json({ sucesso: false, mensagem: "Inválido." });

        const remetente = await User.findById(req.session.user.id);
        const destinatario = await User.findOne({ nfcToken: nfcTokenDestino });

        if (!destinatario) return res.status(404).json({ sucesso: false, mensagem: "Cartão NFC não reconhecido." });
        if (remetente._id.toString() === destinatario._id.toString()) return res.status(400).json({ sucesso: false, mensagem: "Não pode enviar para si mesmo." });
        if (remetente.saldo < valorNum) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });

        remetente.saldo -= valorNum; destinatario.saldo += valorNum;

        await Promise.all([
            remetente.save(), destinatario.save(),
            new Transaction({ userId: remetente._id, tipo: 'Pagamento NFC (Enviado)', descricao: `Aproximação para ${destinatario.nome}`, valor: -valorNum }).save(),
            new Transaction({ userId: destinatario._id, tipo: 'Recebimento NFC (Lido)', descricao: `Aproximação de ${remetente.nome}`, valor: valorNum }).save()
        ]);
        res.json({ sucesso: true, mensagem: `Pagamento Concluído!`, novoSaldo: remetente.saldo });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/nfc/cobrar-aproximacao', checkAuthenticated, async (req, res) => {
    try {
        const { nfcTokenPagador, valor } = req.body;
        const valorNum = parseFloat(valor);
        if (!nfcTokenPagador || !valorNum || valorNum <= 0) return res.status(400).json({ sucesso: false, mensagem: "Inválido." });

        const recebedor = await User.findById(req.session.user.id);
        const pagador = await User.findOne({ nfcToken: nfcTokenPagador });

        if (!pagador) return res.status(404).json({ sucesso: false, mensagem: "Cartão NFC não reconhecido." });
        if (recebedor._id.toString() === pagador._id.toString()) return res.status(400).json({ sucesso: false, mensagem: "Inválido." });
        if (pagador.saldo < valorNum) return res.status(400).json({ sucesso: false, mensagem: `Saldo insuficiente no cartão de ${pagador.nome}.` });

        pagador.saldo -= valorNum; recebedor.saldo += valorNum;

        await Promise.all([
            pagador.save(), recebedor.save(),
            new Transaction({ userId: pagador._id, tipo: 'Pagamento NFC (Cobrado)', descricao: `Maquininha de ${recebedor.nome}`, valor: -valorNum }).save(),
            new Transaction({ userId: recebedor._id, tipo: 'Venda NFC (Recebido)', descricao: `De ${pagador.nome}`, valor: valorNum }).save()
        ]);
        res.json({ sucesso: true, mensagem: `Venda Aprovada!`, novoSaldo: recebedor.saldo });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/socio/assinar', checkAuthenticated, async (req, res) => {
    try {
        const { plano, metodoPagamento } = req.body;
        if (!PLANOS_SOCIO[plano] || !metodoPagamento) return res.status(400).json({ sucesso: false, mensagem: "Dados inválidos." });

        const configPlano = PLANOS_SOCIO[plano];
        const user = await User.findById(req.session.user.id);

        if (metodoPagamento === 'Pix') {
            let bodyCob = {
                calendario: { expiracao: 3600 },
                valor: { original: configPlano.valorReais.toFixed(2) },
                chave: process.env.EFI_PIX_KEY, 
                solicitacaoPagador: `Assinatura Plano ${plano} - SolidCoin`
            };

            const cobResponse = await efipayPF.pixCreateImmediateCharge({}, bodyCob);
            const qrCodeResponse = await efipayPF.pixGenerateQRCode({ id: cobResponse.loc.id });

            const novaOrdem = new SocioOrder({
                userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email,
                plano: plano, valorReais: configPlano.valorReais, moedasReceber: configPlano.sc,
                metodoPagamento: 'Pix Efí', txId: cobResponse.txid, status: 'Pendente'
            });
            await novaOrdem.save();

            return res.json({ 
                sucesso: true, 
                mensagem: "Cobrança Pix gerada com sucesso!",
                pixCopiaECola: qrCodeResponse.qrcode,
                imagemQrcode: qrCodeResponse.imagemQrcode,
                txid: cobResponse.txid
            });
        } else {
            const novaOrdem = new SocioOrder({
                userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, plano: plano, 
                valorReais: configPlano.valorReais, moedasReceber: configPlano.sc, metodoPagamento: metodoPagamento, txId: req.body.txId || 'Manual'
            });
            await novaOrdem.save();
            res.json({ sucesso: true, mensagem: `Aviso enviado!` });
        }
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao gerar cobrança Pix na conta PF." }); 
    }
});

// =========================================================================
// CONTINGÊNCIA (FALLBACK) PARA APROVAÇÃO MANUAL EM CASO DE ERRO
// =========================================================================
app.post('/api/solicitar-saque-pix', checkAuthenticated, async (req, res) => {
    try {
        const { valorSC, tipoChave, chavePix } = req.body;
        const valorNum = parseFloat(valorSC);

        if (!valorNum || valorNum <= 0 || !tipoChave || !chavePix) return res.status(400).json({ sucesso: false, mensagem: "Dados inválidos." });

        if (!efipayPJ) {
            return res.status(500).json({ sucesso: false, mensagem: "A API de Pagamentos PJ não está configurada no servidor." });
        }

        const user = await User.findById(req.session.user.id);
        if (user.statusSocio !== 'Ativo') {
            return res.status(403).json({ sucesso: false, mensagem: "Exclusivo para Sócios ativos." });
        }
        if (user.saldo < valorNum) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });

        const limiteDisponivel = await calcularLimiteSaque(user._id, user.saldo, user.email);
        if (valorNum > limiteDisponivel) {
            return res.status(400).json({ sucesso: false, mensagem: `Limite disponível: ${limiteDisponivel.toFixed(2)} SC.` });
        }

        const chaveFavorecidoLimpa = normalizarChavePix(chavePix, tipoChave);
        const chavePagadorLimpa = normalizarChavePix(process.env.EFI_PIX_KEY_PJ); 

        const scRate = await getSCRate();
        const taxaSC = valorNum * 0.05; 
        const valorLiquidoSC = valorNum - taxaSC;
        const valorBRL = valorLiquidoSC / scRate;
        const idEnvio = crypto.randomBytes(16).toString('hex');

        let bodyEnvioPix = {
            valor: valorBRL.toFixed(2),
            pagador: { chave: chavePagadorLimpa }, 
            favorecido: { chave: chaveFavorecidoLimpa } 
        };

        try {
            const envioResponse = await efipayPJ.pixSend({ idEnvio: idEnvio }, bodyEnvioPix);
            
            if (envioResponse.status === 'NAO_REALIZADO' || envioResponse.status === 'RECUSADO' || envioResponse.status === 'FALHA') {
                throw new Error('Pix Recusado pelo banco (CNPJ Bloqueado ou Limite excedido)');
            }

            user.saldo -= valorNum;
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            if (admin) admin.saldo += valorNum; 

            const novoSaquePix = new PixWithdrawal({
                userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, chavePix: chaveFavorecidoLimpa, tipoChavePix: tipoChave,
                valorSC: valorNum, taxaSC: taxaSC, valorBRL: valorBRL, 
                status: 'Aprovado', txId: envioResponse.e2eId || envioResponse.idEnvio || idEnvio
            });

            await Promise.all([
                user.save(), admin ? admin.save() : Promise.resolve(), novoSaquePix.save(),
                new Transaction({ userId: user._id, tipo: 'Saque Pix Automático', descricao: `Chave: ${chaveFavorecidoLimpa}`, valor: -valorNum }).save(),
                admin ? new Transaction({ userId: admin._id, tipo: 'Saque Pix Processado', descricao: `Para ${user.nome}`, valor: valorNum }).save() : Promise.resolve()
            ]);

            return res.json({ sucesso: true, mensagem: `✅ Saque de R$ ${valorBRL.toFixed(2)} transferido via Conta PJ.` });
            
        } catch (erroPix) {
            user.saldo -= valorNum; 
            
            const novoSaquePix = new PixWithdrawal({
                userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, chavePix: chaveFavorecidoLimpa, tipoChavePix: tipoChave,
                valorSC: valorNum, taxaSC: taxaSC, valorBRL: valorBRL, 
                status: 'Pendente', txId: 'Aguardando CEO'
            });

            await Promise.all([
                user.save(), 
                novoSaquePix.save(),
                new Transaction({ userId: user._id, tipo: 'Saque Pix Solicitado', descricao: `Pendente de Aprovação`, valor: -valorNum }).save()
            ]);

            return res.json({ 
                sucesso: true, 
                mensagem: `⚠️ Transação enviada para aprovação do CEO. O pagamento será processado manualmente em breve!` 
            });
        }
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro geral ao processar saque." }); }
});

app.post('/api/webhook/pix', async (req, res) => {
    res.status(200).send('OK');
    try {
        if (req.body.pix && req.body.pix.length > 0) {
            for (let pagamento of req.body.pix) {
                const txid_pago = pagamento.txid;
                const ordem = await SocioOrder.findOne({ txId: txid_pago, status: 'Pendente' });
                
                if (ordem) {
                    const user = await User.findById(ordem.userId);
                    const admin = await User.findOne({ email: ADMIN_EMAIL });
                    
                    if (admin && admin.saldo >= ordem.moedasReceber) {
                        admin.saldo -= ordem.moedasReceber; user.saldo += ordem.moedasReceber;
                        user.statusSocio = 'Ativo'; user.planoSocio = ordem.plano; user.vencimentoSocio = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); 
                        ordem.status = 'Aprovado';

                        const transacoesToSave = [
                            new Transaction({ userId: user._id, tipo: 'Assinatura Sócio SolidCoin', descricao: `Plano ${ordem.plano}`, valor: ordem.moedasReceber }),
                            new Transaction({ userId: admin._id, tipo: 'Pagamento Sócio', descricao: `Para ${user.nome}`, valor: -ordem.moedasReceber })
                        ];
                        const updatesToSave = [user.save(), ordem.save()];

                        if (user.indicadoPor) {
                            const referrer = await User.findById(user.indicadoPor);
                            if (referrer && admin.saldo >= (ordem.moedasReceber * 0.05)) {
                                admin.saldo -= (ordem.moedasReceber * 0.05); referrer.saldo += (ordem.moedasReceber * 0.05);
                                transacoesToSave.push(new Transaction({ userId: referrer._id, tipo: 'Comissão de Indicação (Sócio)', descricao: `5% de ${user.nome}`, valor: (ordem.moedasReceber * 0.05) }));
                                transacoesToSave.push(new Transaction({ userId: admin._id, tipo: 'Pagamento de Comissão', descricao: `Para ${referrer.nome}`, valor: -(ordem.moedasReceber * 0.05) }));
                                updatesToSave.push(referrer.save());
                            }
                        }
                        updatesToSave.push(admin.save());
                        for (let tx of transacoesToSave) updatesToSave.push(tx.save());
                        await Promise.all(updatesToSave);
                    }
                }
            }
        }
    } catch (e) { }
});

app.post('/api/admin/verificar-pix-efi', isAdmin, async (req, res) => {
    try {
        const ordensPendentes = await SocioOrder.find({ status: 'Pendente', metodoPagamento: 'Pix Efí' });
        let aprovadas = 0;

        for (let ordem of ordensPendentes) {
            try {
                const cob = await efipayPF.pixDetailCharge({ txid: ordem.txId });
                if (cob.status === 'CONCLUIDA') {
                    const user = await User.findById(ordem.userId);
                    const admin = await User.findOne({ email: ADMIN_EMAIL });
                    if (admin && admin.saldo >= ordem.moedasReceber) {
                        admin.saldo -= ordem.moedasReceber; user.saldo += ordem.moedasReceber;
                        user.statusSocio = 'Ativo'; user.planoSocio = ordem.plano; user.vencimentoSocio = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); 
                        ordem.status = 'Aprovado';
                        await Promise.all([
                            user.save(), admin.save(), ordem.save(),
                            new Transaction({ userId: user._id, tipo: 'Assinatura Sócio SolidCoin', descricao: `Verificado pelo ADM`, valor: ordem.moedasReceber }).save()
                        ]);
                        aprovadas++;
                    }
                }
            } catch (e) { }
        }
        res.json({ sucesso: true, mensagem: `Sincronização concluída. ${aprovadas} pagamentos Pix foram identificados.` });
    } catch (e) { res.status(500).json({ sucesso: false, mensagem: "Erro ao comunicar com a Efí." }); }
});

app.post('/api/admin/ativar-webhook-efi', isAdmin, async (req, res) => {
    try {
        const chave = process.env.EFI_PIX_KEY;
        const webhookUrl = "https://www.solidcoincommunity.com/api/webhook/pix";

        if (!chave) return res.status(400).json({ sucesso: false, mensagem: "Chave Pix PF não encontrada." });
        
        const response = await efipayPF.pixConfigWebhook({ chave: chave }, { webhookUrl: webhookUrl });
        res.json({ sucesso: true, mensagem: "Webhook cadastrado na Efí PF com sucesso!", detalhes: response });
    } catch (error) {
        res.status(500).json({ sucesso: false, mensagem: `A Efí PF recusou o cadastro do webhook.` });
    }
});

app.post('/api/depositar', checkAuthenticated, async (req, res) => {
    try {
        const { rede, linkTransacao, valor } = req.body;
        const valorNum = parseFloat(valor);
        if (!rede || !linkTransacao || !valorNum || valorNum <= 0) return res.status(400).json({ sucesso: false, mensagem: "Dados inválidos." });

        const user = await User.findById(req.session.user.id);
        await new Deposit({ userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, rede, linkTransacao, valor: valorNum }).save();
        res.json({ sucesso: true, mensagem: "Aviso de depósito enviado! O ADM irá verificar." });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao registrar depósito." }); }
});

app.post('/api/salvar-carteira', checkAuthenticated, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.session.user.id, { 
            solanaWallet: req.body.solanaWallet || '', 
            tronWallet: req.body.tronWallet || '',
            minipayWallet: req.body.minipayWallet || '' 
        });
        res.json({ sucesso: true, mensagem: "Carteiras atualizadas com sucesso!" });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao salvar carteiras." }); }
});

app.post('/api/solicitar-saque', checkAuthenticated, async (req, res) => {
    try {
        const valor = parseFloat(req.body.valor);
        const metodo = req.body.metodo; 
        const user = await User.findById(req.session.user.id);
        
        if (!valor || valor <= 0) return res.status(400).json({ sucesso: false, mensagem: "Valor inválido." });
        
        let carteiraParaSaque = '';
        if (metodo === 'MiniPay') {
            if (!user.minipayWallet) return res.status(400).json({ sucesso: false, mensagem: "Salve sua carteira MiniPay primeiro."});
            carteiraParaSaque = `MiniPay: ${user.minipayWallet}`;
        } else if (metodo === 'Solana') {
            if (!user.solanaWallet) return res.status(400).json({ sucesso: false, mensagem: "Salve sua carteira Solana primeiro."});
            carteiraParaSaque = `Solana: ${user.solanaWallet}`;
        } else {
            if (!user.tronWallet && !user.solanaWallet && !user.minipayWallet) return res.status(400).json({ sucesso: false, mensagem: "Você precisa salvar pelo menos uma carteira de saque."});
            carteiraParaSaque = metodo === 'Tron' ? `Tron: ${user.tronWallet}` : (user.solanaWallet ? `Solana: ${user.solanaWallet}` : (user.tronWallet ? `Tron: ${user.tronWallet}` : `MiniPay: ${user.minipayWallet}`));
        }

        if (user.saldo < valor) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });
        
        const limiteDisponivel = await calcularLimiteSaque(user._id, user.saldo, user.email);
        if (valor > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Saque Bloqueado. Limite disponível: ${limiteDisponivel.toFixed(2)} SC.` });

        user.saldo -= valor; await user.save();

        await Promise.all([
            new Withdrawal({ userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, solanaWallet: carteiraParaSaque, valor: valor, status: 'Pendente' }).save(),
            new Transaction({ userId: user._id, tipo: 'Saque Cripto Solicitado', descricao: carteiraParaSaque.split(':')[0], valor: -valor }).save()
        ]);
        res.json({ sucesso: true, mensagem: `Solicitação de saque via ${carteiraParaSaque.split(':')[0]} enviada!` });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao solicitar saque." }); }
});

app.get('/api/meus-saques', checkAuthenticated, async (req, res) => {
    try {
        const saquesCripto = await Withdrawal.find({ userId: req.session.user.id }).lean();
        const saquesPix = await PixWithdrawal.find({ userId: req.session.user.id }).lean();
        const historico = [
            ...saquesCripto.map(s => ({ ...s, valor: s.valor, solanaWallet: s.solanaWallet })),
            ...saquesPix.map(s => ({ ...s, valor: s.valorSC, solanaWallet: `PIX: ${s.chavePix} (R$ ${s.valorBRL.toFixed(2)})` }))
        ].sort((a, b) => b.data - a.data);
        res.json({ sucesso: true, saques: historico });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao buscar saques." }); }
});

app.post('/api/staking/stake', checkAuthenticated, async (req, res) => {
    try {
        const valor = parseFloat(req.body.valor);
        const user = await User.findById(req.session.user.id);
        if (!valor || valor <= 0 || user.saldo < valor) return res.status(400).json({ sucesso: false, mensagem: "Inválido ou saldo insuficiente." });

        user.saldo -= valor; user.stakedAmount += valor; user.canUnstakeAt = new Date(Date.now() + 48 * 60 * 60 * 1000); user.lastRewardClaim = new Date(); 
        await user.save();
        res.json({ sucesso: true, mensagem: `${valor} SC em staking!`, usuario: { saldo: user.saldo, stakedAmount: user.stakedAmount } });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao fazer staking." }); }
});

app.post('/api/staking/unstake', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const admin = await User.findOne({ email: ADMIN_EMAIL });

        if (user.stakedAmount <= 0) return res.status(400).json({ sucesso: false, mensagem: "Não tem moedas." });
        if (new Date() < new Date(user.canUnstakeAt)) return res.status(400).json({ sucesso: false, mensagem: "No aguardo do prazo 48h."});

        const diasPassados = (Date.now() - new Date(user.lastRewardClaim)) / (1000 * 60 * 60 * 24);
        let recompensaCalculada = (user.stakedAmount * (STAKING_REWARD_RATE_MONTHLY / 30)) * diasPassados;
        if (recompensaCalculada < 0) recompensaCalculada = 0;
        if (recompensaCalculada > 0 && admin.saldo < recompensaCalculada) return res.status(500).json({ sucesso: false, mensagem: "Recursos indisponíveis." });

        const valorResgatado = user.stakedAmount;
        user.saldo += (valorResgatado + recompensaCalculada);
        user.stakedAmount = 0; user.canUnstakeAt = null;

        if (recompensaCalculada > 0) admin.saldo -= recompensaCalculada;

        const txs = [new Transaction({ userId: user._id, tipo: 'Retorno de Staking', descricao: `Capital`, valor: valorResgatado })];
        if (recompensaCalculada > 0) txs.push(new Transaction({ userId: user._id, tipo: 'Recompensa de Staking', descricao: `Rendimento`, valor: recompensaCalculada }));

        await Promise.all([user.save(), admin.save(), ...txs.map(t => t.save())]);
        res.json({ sucesso: true, mensagem: `Resgate Concluído!`, usuario: { saldo: user.saldo, stakedAmount: user.stakedAmount } });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao resgatar staking." }); }
});

app.post('/api/staking/claim-rewards', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const admin = await User.findOne({ email: ADMIN_EMAIL });
        if (user.stakedAmount <= 0) return res.status(400).json({ sucesso: false, mensagem: "Precisa de moedas em staking." });

        const diasPassados = (Date.now() - new Date(user.lastRewardClaim)) / (1000 * 60 * 60 * 24);
        const recompensaCalculada = (user.stakedAmount * (STAKING_REWARD_RATE_MONTHLY / 30)) * diasPassados;

        if (recompensaCalculada < 0.01) return res.status(400).json({ sucesso: false, mensagem: "Muito baixa." });
        if (admin.saldo < recompensaCalculada) return res.status(500).json({ sucesso: false, mensagem: "Indisponível." });

        admin.saldo -= recompensaCalculada; user.saldo += recompensaCalculada; user.lastRewardClaim = Date.now();
        await Promise.all([user.save(), admin.save(), new Transaction({ userId: user._id, tipo: 'Recompensa de Staking', descricao: `Reivindicação`, valor: recompensaCalculada }).save()]);
        res.json({ sucesso: true, mensagem: `Você reivindicou ${recompensaCalculada.toFixed(2)} SC!`, usuario:{ saldo: user.saldo }});
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao reivindicar." }); }
});

app.post('/api/giftcard/comprar', checkAuthenticated, async (req, res) => {
    try {
        const { tipo, valorReais } = req.body;
        const valorR = parseFloat(valorReais);
        const scRate = await getSCRate();
        const valorSC = valorR * scRate;
        const [user, admin] = await Promise.all([ User.findById(req.session.user.id), User.findOne({ email: ADMIN_EMAIL }) ]);
        if (user.saldo < valorSC) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });

        user.saldo -= valorSC; admin.saldo += valorSC;
        const order = new GiftCardOrder({ userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, tipoGift: tipo, tipo: tipo, valorReais: valorR, valorBRL: valorR, valorSolidCoin: valorSC, custoSolidCoin: valorSC, status: 'Pendente' });
        await Promise.all([user.save(), admin.save(), order.save(), new Transaction({ userId: user._id, tipo: 'Compra Gift Card', descricao: `Pedido ${tipo}`, valor: -valorSC }).save(), new Transaction({ userId: admin._id, tipo: 'Venda Gift Card', descricao: `Para ${user.nome}`, valor: valorSC }).save()]);
        res.json({ sucesso: true, mensagem: `Pedido enviado! O ADM enviará o PIN no extrato.`, novoSaldo: user.saldo });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro compra Gift Card." }); }
});

app.post('/api/recharge/comprar', checkAuthenticated, async (req, res) => {
    try {
        const { operadora, valorReais, numeroCelular } = req.body;
        const scRate = await getSCRate();
        const valorSC = parseFloat(valorReais) * scRate;
        const [user, admin] = await Promise.all([ User.findById(req.session.user.id), User.findOne({ email: ADMIN_EMAIL }) ]);
        if (user.saldo < valorSC) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });

        user.saldo -= valorSC; admin.saldo += valorSC;
        const order = new RechargeOrder({ userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, operadora, numeroCelular, valorReais: parseFloat(valorReais), valorSolidCoin: valorSC, status: 'Pendente' });
        await Promise.all([user.save(), admin.save(), order.save(), new Transaction({ userId: user._id, tipo: 'Recarga de Celular', descricao: `Pedido ${operadora}`, valor: -valorSC }).save(), new Transaction({ userId: admin._id, tipo: 'Venda Recarga', descricao: `Para ${user.nome}`, valor: valorSC }).save()]);
        res.json({ sucesso: true, mensagem: `Pedido enviado! NSU em breve.`, novoSaldo: user.saldo });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao pedir Recarga." }); }
});

app.post('/api/transferir', checkAuthenticated, async (req, res) => {
    const { emailDestinatario, valor } = req.body;
    const valorNum = parseFloat(valor);
    if (!emailDestinatario || !valorNum || valorNum <= 0) return res.status(400).json({ sucesso: false, mensagem: "Inválido." });
    try {
        const remetente = await User.findById(req.session.user.id);
        const destinatario = await User.findOne({ email: emailDestinatario });
        if (!destinatario || remetente.email === destinatario.email || remetente.saldo < valorNum) return res.status(400).json({ sucesso: false, mensagem: "Invalido ou insuficiente." });
        
        remetente.saldo -= valorNum; destinatario.saldo += valorNum;
        await Promise.all([remetente.save(), destinatario.save(), new Transaction({ userId: remetente._id, tipo: 'Transferência Enviada', descricao: `Para ${destinatario.nome}`, valor: -valorNum }).save(), new Transaction({ userId: destinatario._id, tipo: 'Transferência Recebida', descricao: `De ${remetente.nome}`, valor: valorNum }).save()]);
        res.json({ sucesso: true, mensagem: "Transferência realizada!", novoSaldo: remetente.saldo });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro." }); }
});

app.post('/api/comprar', checkAuthenticated, async (req, res) => {
    try {
        const [comprador, admin, produto] = await Promise.all([ User.findById(req.session.user.id), User.findOne({ email: ADMIN_EMAIL }), Product.findById(req.body.produtoId) ]);
        if (!produto || comprador.saldo < produto.preco) return res.status(400).json({ sucesso: false, mensagem: "Inválido/Insuficiente." });
        
        comprador.saldo -= produto.preco; admin.saldo += produto.preco;
        await Promise.all([comprador.save(), admin.save(), new Transaction({ userId: comprador._id, tipo: 'Compra no Marketplace', descricao: `${produto.nome}`, valor: -produto.preco }).save(), new Transaction({ userId: admin._id, tipo: 'Venda no Marketplace', descricao: `${comprador.nome}`, valor: produto.preco }).save()]);
        res.json({ sucesso: true, mensagem: `Comprado!`, novoSaldo: comprador.saldo });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro." }); }
});

app.get('/api/extrato', checkAuthenticated, async (req, res) => {
    try {
        const transacoes = await Transaction.find({ userId: req.session.user.id }).sort({ data: -1 }).limit(50);
        res.json({ sucesso: true, transacoes });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: 'Erro extrato.' }); }
});

app.get('/api/admin/listar-imagens', isAdmin, async (req, res) => {
    try {
        const imagensPlanos = await ImagemConfig.find({ chave: { $regex: '^plano_' } });
        const produtos = await Product.find({});
        res.json({ sucesso: true, planos: imagensPlanos, produtos: produtos });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao carregar imagens." }); }
});

app.post('/api/admin/atualizar-imagem', isAdmin, async (req, res) => {
    try {
        const { tipo, idOuChave, novaUrl } = req.body;
        if (!novaUrl || !novaUrl.startsWith('http')) return res.status(400).json({ sucesso: false, mensagem: "A URL deve começar com http:// ou https://" });

        if (tipo === 'plano') {
            await ImagemConfig.findOneAndUpdate({ chave: idOuChave }, { url: novaUrl }, { upsert: true });
        } else if (tipo === 'produto') {
            await Product.findByIdAndUpdate(idOuChave, { imagemUrl: novaUrl });
        } else {
            return res.status(400).json({ sucesso: false, mensagem: "Tipo inválido." });
        }
        res.json({ sucesso: true, mensagem: "✅ Imagem atualizada com sucesso!" });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao atualizar a imagem." }); }
});

app.get('/api/admin/usuarios', isAdmin, async (req, res) => {
    try {
        const usuarios = await User.find({ email: { $ne: ADMIN_EMAIL } }).select('nome email statusSocio planoSocio');
        res.json({ sucesso: true, usuarios });
    } catch (e) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/alterar-senha-usuario', isAdmin, async (req, res) => {
    try {
        const { userId, novaSenha } = req.body;
        const user = await User.findById(userId);
        if (!user || novaSenha.length < 4) return res.status(400).json({ sucesso: false, mensagem: "Inválido." });
        user.senha = await bcrypt.hash(novaSenha, 10); await user.save();
        res.json({ sucesso: true, mensagem: `Senha redefinida!` });
    } catch (e) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/atualizar-cotacao', isAdmin, async (req, res) => {
    try {
        let settings = await SystemSettings.findOne() || new SystemSettings();
        settings.scPorReal = parseFloat(req.body.cotacao); await settings.save();
        res.json({ sucesso: true, mensagem: `Cotação atualizada.` });
    } catch(e) { res.status(500).json({ sucesso: false }); }
});

app.get('/api/admin/inadimplentes', isAdmin, async (req, res) => {
    try {
        const inadimplentes = await User.find({ statusSocio: 'Inadimplente' }).select('nome email planoSocio vencimentoSocio');
        res.json({ sucesso: true, inadimplentes });
    } catch (e) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/cancelar-socio', isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.body.userId);
        user.statusSocio = 'Inativo'; user.planoSocio = ''; user.vencimentoSocio = null; await user.save();
        res.json({ sucesso: true, mensagem: "Plano cancelado." });
    } catch (e) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/gerar-giftcard-solidcoin', isAdmin, async (req, res) => {
    try {
        const valor = parseFloat(req.body.valor);
        const diasValidade = parseInt(req.body.diasValidade) || 7; 
        const admin = await User.findOne({ email: ADMIN_EMAIL });

        if (!valor || valor <= 0 || admin.saldo < valor) return res.status(400).json({ sucesso: false, mensagem: "Valor inválido/saldo insuficiente CEO." });

        const cod = 'SOLID-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const dataValidade = new Date(Date.now() + diasValidade * 24 * 60 * 60 * 1000);

        admin.saldo -= valor;
        await Promise.all([ 
            admin.save(), 
            new SolidCoinGiftCard({ codigo: cod, valor: valor, validade: dataValidade, status: 'Disponivel' }).save(), 
            new Transaction({ userId: admin._id, tipo: 'Geração Gift SC', descricao: `${cod} (${diasValidade} dias)`, valor: -valor }).save() 
        ]);
        res.json({ sucesso: true, mensagem: `✅ Gift Card Criado: ${cod}` });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.get('/api/admin/listar-giftcards-solidcoin', isAdmin, async (req, res) => {
    try {
        const lista = await SolidCoinGiftCard.find().sort({ criadoEm: -1 });
        res.json({ sucesso: true, giftcards: lista });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/resgatar-giftcard-solidcoin', checkAuthenticated, async (req, res) => {
    try {
        const giftCard = await SolidCoinGiftCard.findOne({ codigo: req.body.codigo.toUpperCase() });
        if (!giftCard || giftCard.isUsed || giftCard.status !== 'Disponivel') return res.status(400).json({ sucesso: false, mensagem: "Código inválido, já utilizado ou expirado." });

        if (new Date() > new Date(giftCard.validade)) {
            giftCard.status = 'Expirado'; giftCard.isUsed = true; await giftCard.save();
            return res.status(400).json({ sucesso: false, mensagem: "⚠️ Código expirado." });
        }

        const user = await User.findById(req.session.user.id);
        user.saldo += giftCard.valor; giftCard.isUsed = true; giftCard.status = 'Resgatado'; giftCard.usedBy = user._id; giftCard.nomeResgatador = user.nome; giftCard.usedAt = new Date();

        await Promise.all([
            user.save(), giftCard.save(), 
            new Transaction({ userId: user._id, tipo: 'Resgate Gift SC', descricao: giftCard.codigo, valor: giftCard.valor }).save()
        ]);
        res.json({ sucesso: true, mensagem: `🎉 Resgatado com sucesso!`, novoSaldo: user.saldo });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.get('/api/admin/pedidos-pendentes', isAdmin, async (req, res) => {
    try {
        const saques = await Withdrawal.find({ status: 'Pendente' }).sort({ data: 1 });
        const gifts = await GiftCardOrder.find({ status: 'Pendente' }).sort({ data: 1 });
        const recharges = await RechargeOrder.find({ status: 'Pendente' }).sort({ data: 1 });
        const depositos = await Deposit.find({ status: 'Pendente' }).sort({ data: 1 });
        const socios = await SocioOrder.find({ status: 'Pendente' }).sort({ data: 1 });
        const saquesPix = await PixWithdrawal.find({ status: 'Pendente' }).sort({ data: 1 }); 
        const cartoesNfc = await NfcOrder.find({ status: 'Pendente' }).sort({ data: 1 });

        res.json({ sucesso: true, saques, gifts, recharges, depositos, socios, saquesPix, cartoesNfc });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/processar-socio', isAdmin, async (req, res) => {
    try {
        const { orderId, acao } = req.body;
        const ordem = await SocioOrder.findById(orderId);
        if (!ordem || ordem.status !== 'Pendente') return res.status(404).json({ sucesso: false, mensagem: "Não encontrado." });

        if (acao === 'aprovar') {
            const user = await User.findById(ordem.userId); const admin = await User.findOne({ email: ADMIN_EMAIL });
            if (admin.saldo < ordem.moedasReceber) return res.status(400).json({ sucesso: false, mensagem: "Sem saldo CEO." });

            admin.saldo -= ordem.moedasReceber; user.saldo += ordem.moedasReceber; user.statusSocio = 'Ativo'; user.planoSocio = ordem.plano; user.vencimentoSocio = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); ordem.status = 'Aprovado';
            const txs = [new Transaction({ userId: user._id, tipo: 'Assinatura', descricao: ordem.plano, valor: ordem.moedasReceber }), new Transaction({ userId: admin._id, tipo: 'Pagamento Sócio', descricao: user.nome, valor: -ordem.moedasReceber })];
            const updates = [user.save(), ordem.save()];

            if (user.indicadoPor) {
                const referrer = await User.findById(user.indicadoPor);
                if (referrer && admin.saldo >= (ordem.moedasReceber * 0.05)) {
                    admin.saldo -= (ordem.moedasReceber * 0.05); referrer.saldo += (ordem.moedasReceber * 0.05);
                    txs.push(new Transaction({ userId: referrer._id, tipo: 'Comissão', descricao: `5%`, valor: (ordem.moedasReceber * 0.05) }), new Transaction({ userId: admin._id, tipo: 'Pgt Comissao', descricao: referrer.nome, valor: -(ordem.moedasReceber * 0.05) }));
                    updates.push(referrer.save());
                }
            }
            updates.push(admin.save()); for (let tx of txs) updates.push(tx.save());
            await Promise.all(updates); res.json({ sucesso: true, mensagem: `Aprovado!` });
        } else {
            ordem.status = 'Rejeitado'; await ordem.save(); res.json({ sucesso: true, mensagem: "Rejeitado." });
        }
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/processar-deposito', isAdmin, async (req, res) => {
    try {
        const { depositId, acao } = req.body;
        const deposito = await Deposit.findById(depositId);
        if (!deposito || deposito.status !== 'Pendente') return res.status(404).json({ sucesso: false });
        const user = await User.findById(deposito.userId); const admin = await User.findOne({ email: ADMIN_EMAIL });

        if (acao === 'aprovar') {
            if (admin.saldo < deposito.valor) return res.status(400).json({ sucesso: false, mensagem: "Sem saldo CEO." });
            admin.saldo -= deposito.valor; user.saldo += deposito.valor; deposito.status = 'Aprovado';
            await Promise.all([user.save(), admin.save(), deposito.save(), new Transaction({ userId: user._id, tipo: 'Depósito Aprovado', descricao: deposito.rede, valor: deposito.valor }).save(), new Transaction({ userId: admin._id, tipo: 'Depósito Creditado', descricao: user.nome, valor: -deposito.valor }).save()]);
            res.json({ sucesso: true, mensagem: "APROVADO!" });
        } else {
            deposito.status = 'Rejeitado'; await deposito.save(); res.json({ sucesso: true, mensagem: "REJEITADO." });
        }
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/processar-saque', isAdmin, async (req, res) => {
    try {
        const { withdrawalId, acao } = req.body;
        const saque = await Withdrawal.findById(withdrawalId);
        if (!saque || saque.status !== 'Pendente') return res.status(404).json({ sucesso: false });
        
        if (acao === 'aprovar') {
            // =========================================================================
            // LÓGICA DE PAGAMENTO AUTOMÁTICO MINIPAY (REDE CELO - USDC)
            // =========================================================================
            if (saque.solanaWallet && saque.solanaWallet.includes('MiniPay:')) {
                if (!usdcContract) return res.status(500).json({ sucesso: false, mensagem: "Erro: A carteira MiniPay do Servidor não está configurada (Falta a Seed Phrase no Render)." });
                
                try {
                    const enderecoDestino = saque.solanaWallet.replace('MiniPay:', '').trim();
                    const scRate = await getSCRate();
                    
                    // --- BUSCA A COTAÇÃO REAL DO DÓLAR ---
                    const resMoeda = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
                    const dadosMoeda = await resMoeda.json();
                    const cotacaoDolar = parseFloat(dadosMoeda.USDBRL.ask);
                    
                    const valorBRL = saque.valor / scRate;
                    const valorUSDC = valorBRL / cotacaoDolar;
                    
                    const { ethers } = require('ethers');
                    // IMPORTANTE: USDC tem 6 casas decimais (10^6), não 18!
                    const amountWei = ethers.parseUnits(valorUSDC.toFixed(6), 6);
                    
                    const tx = await usdcContract.transfer(enderecoDestino, amountWei);
                    saque.txId = tx.hash; // Salva o comprovante blockchain internamente
                } catch (txError) {
                    console.error("Falha na Blockchain Celo:", txError);
                    return res.status(500).json({ sucesso: false, mensagem: "A transação MiniPay falhou. Verifique se o servidor tem CELO (Gás) e USDC suficientes." });
                }
            }

            saque.status = 'Aprovado'; await saque.save(); 
            res.json({ sucesso: true, mensagem: `APROVADO.`});
        } else if (acao === 'rejeitar') {
            const user = await User.findById(saque.userId);
            user.saldo += saque.valor; saque.status = 'Rejeitado';
            await Promise.all([user.save(), saque.save(), new Transaction({ userId: user._id, tipo: 'Estorno', descricao: saque.solanaWallet.split(':')[0], valor: saque.valor }).save()]);
            res.json({ sucesso: true, mensagem: "REJEITADO." });
        }
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/processar-saque-pix', isAdmin, async (req, res) => {
    try {
        const { withdrawalId, acao, txId } = req.body;
        const saque = await PixWithdrawal.findById(withdrawalId);
        if (!saque || saque.status !== 'Pendente') return res.status(404).json({ sucesso: false });
        
        if (acao === 'aprovar') {
            saque.status = 'Aprovado'; saque.txId = txId || 'Manual';
            const admin = await User.findOne({email: ADMIN_EMAIL}); admin.saldo += saque.valorSC;
            await Promise.all([saque.save(), admin.save(), new Transaction({ userId: admin._id, tipo: 'Receb SC Pix', descricao: saque.nomeUsuario, valor: saque.valorSC }).save()]);
            res.json({ sucesso: true, mensagem: `APROVADO.`});
        } else if (acao === 'rejeitar') {
            const user = await User.findById(saque.userId);
            user.saldo += saque.valorSC; saque.status = 'Rejeitado';
            await Promise.all([user.save(), saque.save(), new Transaction({ userId: user._id, tipo: 'Estorno Pix', descricao: `ADM`, valor: saque.valorSC }).save()]);
            res.json({ sucesso: true, mensagem: "REJEITADO." });
        }
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/processar-giftcard', isAdmin, async (req, res) => {
    try {
        const { orderId, acao, pin } = req.body;
        const order = await GiftCardOrder.findById(orderId);
        if (!order || order.status !== 'Pendente') return res.status(404).json({ sucesso: false });

        if (acao === 'aprovar' || acao === 'enviar_pin') { 
            order.status = 'Concluido'; order.pin = pin;
            await Promise.all([order.save(), new Transaction({ userId: order.userId, tipo: 'Entrega Gift', descricao: `PIN: ${pin}`, valor: 0 }).save()]);
            res.json({ sucesso: true, mensagem: "Enviado!" });
        } else if (acao === 'rejeitar') {
            const user = await User.findById(order.userId); const admin = await User.findOne({ email: ADMIN_EMAIL });
            const custoReal = order.valorSolidCoin || order.custoSolidCoin;
            user.saldo += custoReal; admin.saldo -= custoReal; order.status = 'Rejeitado';
            await Promise.all([user.save(), admin.save(), order.save(), new Transaction({ userId: user._id, tipo: 'Estorno Gift', descricao: `Reembolso.`, valor: custoReal }).save()]);
            res.json({ sucesso: true, mensagem: "Estornado."});
        }
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/processar-recharge', isAdmin, async (req, res) => {
    try {
        const { rechargeId, acao, nsu } = req.body;
        const order = await RechargeOrder.findById(rechargeId);
        if (!order || order.status !== 'Pendente') return res.status(400).json({ sucesso: false });
        const [user, admin] = await Promise.all([User.findById(order.userId), User.findOne({ email: ADMIN_EMAIL })]);

        if (acao === 'aprovar') {
            order.status = 'Concluido'; order.nsu = nsu;
            await Promise.all([order.save(), new Transaction({ userId: user._id, tipo: 'Recarga Concluída', descricao: `NSU: ${nsu}`, valor: 0 }).save()]);
            res.json({ sucesso: true, mensagem: "Enviado!" });
        } else {
            order.status = 'Rejeitado'; admin.saldo -= order.valorSolidCoin; user.saldo += order.valorSolidCoin;
            await Promise.all([order.save(), admin.save(), user.save(), new Transaction({ userId: user._id, tipo: 'Reembolso Recarga', descricao: `Cancelada`, valor: order.valorSolidCoin }).save()]);
            res.json({ sucesso: true, mensagem: "Cancelado." });
        }
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/processar-nfc', isAdmin, async (req, res) => {
    try {
        const { orderId, acao } = req.body;
        const order = await NfcOrder.findById(orderId);
        if (!order || order.status !== 'Pendente') return res.status(404).json({ sucesso: false });

        if (acao === 'aprovar') {
            order.status = 'Concluido'; 
            await order.save();
            res.json({ sucesso: true, mensagem: "Cartão marcado como Gravado e Enviado!" });
        } else {
            const user = await User.findById(order.userId); 
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            user.saldo += 1600; admin.saldo -= 1600; order.status = 'Rejeitado';
            await Promise.all([
                user.save(), admin.save(), order.save(), 
                new Transaction({ userId: user._id, tipo: 'Estorno Cartão NFC', descricao: `Cancelado pelo ADM`, valor: 1600 }).save()
            ]);
            res.json({ sucesso: true, mensagem: "Pedido Cancelado. 1.600 SC estornados ao usuário." });
        }
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.use('/api/investimentos', checkAuthenticated, investimentosRoutes);
app.use('/api', checkAuthenticated, investimentosRoutes); 

async function setupInicial() {
    try {
        let ceo = await User.findOne({ email: ADMIN_EMAIL });
        if (!ceo) {
            const senhaHash = await bcrypt.hash("SolidCoin$24", 10);
            ceo = new User({ nome: "CEO SolidCoin", email: ADMIN_EMAIL, senha: senhaHash, saldo: 1000000000, codigoIndicacao: 'CEO123' });
            await ceo.save();
        } else if (!ceo.codigoIndicacao) { ceo.codigoIndicacao = 'CEO123'; await ceo.save(); }
        
        if (await Product.countDocuments() === 0) {
            await Product.insertMany([
                { nome: 'Cedula SC 1000', preco: 1000, imagemUrl: 'https://i.postimg.cc/vBmmytJq/projeto-page-0001.png', categoria: 'Cédulas'},
                { nome: 'Cedula SC 5000', preco: 5000, imagemUrl: 'https://i.postimg.cc/1XZDMTnn/projeto2-page-0001.png', categoria: 'Cédulas'},
                { nome: 'Cedula SC 10000', preco: 10000, imagemUrl: 'https://i.postimg.cc/XNwfXVmw/projeto3-page-0001.png', categoria: 'Cédulas'},
                { nome: 'Cedula SC 100000', preco: 100000, imagemUrl: 'https://i.postimg.cc/MHxj1QN1/projeto4-page-0001.png', categoria: 'Cédulas'}
            ]);
        }
        
        const nomesDosPlanos = Object.keys(PLANOS_SOCIO);
        for (const planoNome of nomesDosPlanos) {
            const chavePlano = `plano_${planoNome}`;
            const imagemExistente = await ImagemConfig.findOne({ chave: chavePlano });
            if (!imagemExistente) {
                await new ImagemConfig({ chave: chavePlano, nomeExibicao: `Imagem: ${planoNome}`, url: PLANOS_SOCIO[planoNome].imagemUrl }).save();
            }
        }

        // --- CADASTRA AUTOMATICAMENTE O PRIMEIRO LINK DE REFERÊNCIA ---
        if (await ReferralLink.countDocuments() === 0) {
            await new ReferralLink({
                titulo: 'MultSense - Parceiro Oficial SolidCoin',
                descricao: 'Cadastre-se na plataforma MultSense através do nosso link oficial de referência.',
                url: 'https://multsense.com.br/?ref=SolidCoin'
            }).save();
        }

        if (!(await SystemSettings.findOne())) { await new SystemSettings({ scPorReal: 500 }).save(); }
    } catch (e) { console.error("Erro no setup inicial:", e); }
}

async function verificarPixPendentesAutomatizado() {
    try {
        const ordensPendentes = await SocioOrder.find({ status: 'Pendente', metodoPagamento: 'Pix Efí' });
        for (let ordem of ordensPendentes) {
            try {
                const cob = await efipayPF.pixDetailCharge({ txid: ordem.txId });
                if (cob.status === 'CONCLUIDA') {
                    const user = await User.findById(ordem.userId);
                    const admin = await User.findOne({ email: ADMIN_EMAIL });
                    
                    if (admin && admin.saldo >= ordem.moedasReceber) {
                        admin.saldo -= ordem.moedasReceber; user.saldo += ordem.moedasReceber;
                        user.statusSocio = 'Ativo'; user.planoSocio = ordem.plano; user.vencimentoSocio = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); ordem.status = 'Aprovado';
                        
                        const transacoesToSave = [
                            new Transaction({ userId: user._id, tipo: 'Assinatura Sócio SolidCoin', descricao: `Pix Automático (Robô)`, valor: ordem.moedasReceber }),
                            new Transaction({ userId: admin._id, tipo: 'Pagamento Sócio', descricao: `Para ${user.nome}`, valor: -ordem.moedasReceber })
                        ];
                        const updatesToSave = [user.save(), ordem.save()];

                        if (user.indicadoPor) {
                            const referrer = await User.findById(user.indicadoPor);
                            if (referrer) {
                                const comissao = ordem.moedasReceber * 0.05;
                                if (admin.saldo >= comissao) {
                                    admin.saldo -= comissao; referrer.saldo += comissao;
                                    transacoesToSave.push(new Transaction({ userId: referrer._id, tipo: 'Comissão de Indicação (Sócio)', descricao: `Robô: 5% de ${user.nome}`, valor: comissao }));
                                    transacoesToSave.push(new Transaction({ userId: admin._id, tipo: 'Pagamento de Comissão', descricao: `Para ${referrer.nome}`, valor: -comissao }));
                                    updatesToSave.push(referrer.save());
                                }
                            }
                        }
                        updatesToSave.push(admin.save());
                        for (let tx of transacoesToSave) updatesToSave.push(tx.save());
                        await Promise.all(updatesToSave);
                    }
                }
            } catch (e) { }
        }
    } catch (e) { }
}

async function verificarGiftCardsExpirados() {
    try {
        const agora = new Date();
        const vencidos = await SolidCoinGiftCard.find({ status: 'Disponivel', validade: { $lt: agora } });

        if (vencidos.length > 0) {
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            if (!admin) return;

            for (let card of vencidos) {
                card.status = 'Expirado';
                card.isUsed = true;
                admin.saldo += card.valor; 

                await Promise.all([
                    card.save(),
                    new Transaction({ userId: admin._id, tipo: 'Estorno Gift Card SC Expirado', descricao: `Código vencido: ${card.codigo}`, valor: card.valor }).save()
                ]);
            }
            await admin.save();
        }
    } catch (e) { }
}

setInterval(verificarPixPendentesAutomatizado, 60000); 
setInterval(verificarGiftCardsExpirados, 3600000);      

app.listen(PORT, () => { console.log(`\n🚀 SolidCoin App rodando na porta ${PORT}`); });