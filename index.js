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
// --- INTEGRAÇÃO WEB3 REDE CELO (MINIPAY USDC + SOLIDCOIN SLC + SOLIDNFT) ---
// =========================================================================
let celoProvider = null;
let celoWallet = null;
let usdcContract = null;
let slcContract = null;
let solidNftContract = null;

const SOLIDCOIN_CELO_ADDRESS = "0x6Ff689e75DD0f49375A2932E44354DD3271586f6";
const SOLIDNFT_CELO_ADDRESS = "0x4340C2751F443B846262B99EE4f572Bc8784cC65";

try {
    const { ethers } = require('ethers');
    celoProvider = ethers.JsonRpcProvider 
        ? new ethers.JsonRpcProvider('https://forno.celo.org') 
        : new ethers.providers.JsonRpcProvider('https://forno.celo.org');
    
    if (process.env.MINIPAY_SEED_PHRASE) {
        const phrase = process.env.MINIPAY_SEED_PHRASE.trim();
        celoWallet = (ethers.Wallet.fromPhrase ? ethers.Wallet.fromPhrase(phrase) : ethers.Wallet.fromMnemonic(phrase)).connect(celoProvider);
    } else if (process.env.MINIPAY_PRIVATE_KEY) {
        celoWallet = new ethers.Wallet(process.env.MINIPAY_PRIVATE_KEY.trim(), celoProvider);
    }

    if (celoWallet) {
        const USDC_ADDRESS = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
        const erc20Abi = [
            "function transfer(address to, uint256 value) public returns (bool)",
            "function balanceOf(address owner) view returns (uint256)",
            "function allowance(address owner, address spender) view returns (uint256)"
        ];
        const solidNftAbi = [
            "function adminMintComum(address usuario, string memory linkExato) public",
            "function adminMintIncomum(address usuario, string memory linkExato) public",
            "function adminMintRaro(address usuario, string memory linkExato) public",
            "function adminMintLendario(address usuario, string memory linkExato) public",
            "function adminWallet() view returns (address)"
        ];

        usdcContract = new ethers.Contract(USDC_ADDRESS, erc20Abi, celoWallet);
        slcContract = new ethers.Contract(SOLIDCOIN_CELO_ADDRESS, erc20Abi, celoWallet);
        solidNftContract = new ethers.Contract(SOLIDNFT_CELO_ADDRESS, solidNftAbi, celoWallet);

        console.log(`✅ Carteira Admin Celo (${celoWallet.address}) conectada (USDC, SLC e SolidNFT)!`);
    }
} catch (error) {
    console.error("⚠️ Aviso: Biblioteca 'ethers' não instalada ou erro ao configurar carteira Celo:", error.message);
}

// =========================================================================
// --- INTEGRAÇÃO EFÍ (API PIX) E GOOGLE AUTH ---
// =========================================================================
const isSandbox = process.env.EFI_ENV !== 'producao';
console.log(`🌍 MODO EFÍ: ${isSandbox ? 'HOMOLOGAÇÃO (TESTES)' : 'PRODUÇÃO (REAL)'}`);

let googleClient = null;
if (process.env.GOOGLE_CLIENT_ID) {
    googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
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
const PixWithdrawal = require('./models/PixWithdrawal');
const investimentosRoutes = require('./routes/investimentos'); 

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = "solidcoinn@gmail.com";

app.set('trust proxy', 1);

const STAKING_REWARD_RATE_MONTHLY = 0.05; 
const WHALE_THRESHOLD = 1000000; 
const WHALE_YIELD_PER_DAY = 200;
const CUSTO_RECARGA_NFT = 10; 

// --- CONFIGURAÇÕES ECONÔMICAS DO JOGO SOLIDCRUSH SAGA ---
const GAME_MAX_LEVEL = 1000;
const GAME_POINTS_TARGET = 1000000; 
const GAME_SC_REWARD = 1000;        
const GAME_MAX_LIVES = 5;           
const GAME_REFILL_COST_SC = 50;     
const GAME_BOOSTER_MOVES_COST = 20; 

const PLANOS_SOCIO = {
    "Socio SolidCoin para Todos": { valorReais: 1, sc: 500, imagemUrl: "https://i.postimg.cc/QxzG1q50/Design-sem-nome.png" },
    "Iron": { valorReais: 5, sc: 3025, imagemUrl: "https://i.postimg.cc/9MwF9J8R/iron-plan.png" },
    "Bronze": { valorReais: 10, sc: 6325, imagemUrl: "https://i.postimg.cc/Z5F1fF2n/bronze-plan.png" },
    "Prata": { valorReais: 20, sc: 13200, imagemUrl: "https://i.postimg.cc/hP0Zc1p9/silver-plan.png" },
    "Ouro": { valorReais: 50, sc: 34375, imagemUrl: "https://i.postimg.cc/k4T8YnS2/gold-plan.png" },
    "Diamante": { valorReais: 100, sc: 71500, imagemUrl: "https://i.postimg.cc/mZhTbqQ4/diamond-plan.png" }
};

const ImagemConfigSchema = new mongoose.Schema({
    chave: { type: String, required: true, unique: true }, url: { type: String, default: '' }, nomeExibicao: { type: String, default: '' }
});
const ImagemConfig = mongoose.models.ImagemConfig || mongoose.model('ImagemConfig', ImagemConfigSchema);

const NfcOrderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, nomeUsuario: String, emailUsuario: String, enderecoEntrega: String, nfcToken: String, status: { type: String, default: 'Pendente' }, data: { type: Date, default: Date.now }
});
const NfcOrder = mongoose.models.NfcOrder || mongoose.model('NfcOrder', NfcOrderSchema);

const ReferralLinkSchema = new mongoose.Schema({
    titulo: { type: String, required: true }, descricao: { type: String, default: '' }, url: { type: String, required: true }, data: { type: Date, default: Date.now }
});
const ReferralLink = mongoose.models.ReferralLink || mongoose.model('ReferralLink', ReferralLinkSchema);

const NftTemplateSchema = new mongoose.Schema({
    imageUrl: { type: String, required: true },
    metadata: { type: Object, required: true },
    rarity: { type: String, required: true },
    tokenUri: { type: String, default: '' },
    ativo: { type: Boolean, default: true }
});
const NftTemplate = mongoose.models.NftTemplate || mongoose.model('NftTemplate', NftTemplateSchema);

const NftItemSchema = new mongoose.Schema({
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'NftTemplate' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    imageUrl: String,
    tokenUri: { type: String, default: '' },
    metadata: Object,
    mintPrice: Number,
    isEquipped: { type: Boolean, default: false },
    isForSale: { type: Boolean, default: false },
    salePrice: { type: Number, default: 0 },
    lastFarmDate: { type: Date, default: Date.now },
    battery: { type: Number, default: 100 },
    mintDate: { type: Date, default: Date.now }
});
const NftItem = mongoose.models.NftItem || mongoose.model('NftItem', NftItemSchema);

const GameProfileSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
    level: { type: Number, default: 1 },
    accumulatedPoints: { type: Number, default: 0 },
    totalPointsEarned: { type: Number, default: 0 },
    totalScWon: { type: Number, default: 0 },
    lives: { type: Number, default: 5 },
    lastLifeReset: { type: Date, default: Date.now },
    lastLevelCompletedAt: { type: Date, default: new Date(0) }
});
const GameProfile = mongoose.models.GameProfile || mongoose.model('GameProfile', GameProfileSchema);

const SystemSettingsSchema = new mongoose.Schema({
    scPorReal: { type: Number, default: 500 },
    nftPrices: {
        Comum: { type: Number, default: 1600 },
        Incomum: { type: Number, default: 3200 },
        Raro: { type: Number, default: 8000 },
        Lendario: { type: Number, default: 16000 }
    }
});
if(mongoose.models.SystemSettings) delete mongoose.models.SystemSettings;
const SysSettings = mongoose.model('SystemSettings', SystemSettingsSchema);


mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true }).then(() => { setupInicial(); }).catch(err => console.error(err));

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
    let settings = await SysSettings.findOne();
    if (!settings) settings = await new SysSettings({ scPorReal: 500 }).save(); 
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
    let moedasBloqueadas = 0;
    const agora = Date.now();

    txs.forEach(tx => {
        if (tx.tipo === 'Assinatura Sócio SolidCoin' || tx.tipo === 'Assinatura' || tx.tipo === 'Prêmio SolidCrush Saga') {
            const valorAnalisado = parseFloat(tx.valor);
            if (!isNaN(valorAnalisado) && valorAnalisado > 0) { 
                let dataTx = tx.data || tx.createdAt || tx.date || tx.criadoEm;
                if (!dataTx && tx._id && typeof tx._id.getTimestamp === 'function') dataTx = tx._id.getTimestamp();
                if (!dataTx) dataTx = Date.now();
                
                const timestampTx = new Date(dataTx).getTime();
                const mesesPassados = Math.floor(((agora - timestampTx) / (1000 * 60 * 60 * 24)) / 30);
                
                let percentualLiberado = mesesPassados * 0.25;
                if (percentualLiberado > 1.0) percentualLiberado = 1.0;
                
                const percentualBloqueado = 1.0 - percentualLiberado;
                moedasBloqueadas += (valorAnalisado * percentualBloqueado);
            }
        }
    });

    const limiteDisponivel = currentSaldo - moedasBloqueadas;
    return Math.max(0, limiteDisponivel);
}

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// =========================================================================
// --- ROTA PÚBLICA QUE ENTREGA O JSON SALVO NO BANCO PARA A BLOCKCHAIN ---
// =========================================================================
app.get('/api/nfts/metadata/:id', async (req, res) => {
    try {
        const cleanId = String(req.params.id || '').replace(/\.json$/i, '').trim();
        let doc = await NftTemplate.findById(cleanId).lean();
        if (!doc) {
            doc = await NftItem.findById(cleanId).lean();
        }
        if (!doc || !doc.metadata) {
            return res.status(404).json({ error: "Metadata do NFT não encontrado no banco de dados." });
        }

        const metadataJson = JSON.parse(JSON.stringify(doc.metadata));

        // Garante que o campo image dentro do JSON tenha o link HTTP válido para abrir na MetaMask/CeloScan
        let img = metadataJson.image || doc.imageUrl || '';
        if (img.startsWith('ipfs://')) {
            img = img.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }
        metadataJson.image = img;

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        return res.json(metadataJson);
    } catch (e) {
        return res.status(500).json({ error: "Erro ao ler JSON do NFT no banco de dados." });
    }
});

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
        if (referrer && admin) {
            const isCeoReferrer = referrer.email === ADMIN_EMAIL;
            const custoAdmin = isCeoReferrer ? 250 : 500;

            if (admin.saldo >= custoAdmin) {
                saldoInicial = 250;
                indicadoPorId = referrer._id;
                admin.saldo -= custoAdmin;

                if (isCeoReferrer) {
                    await Promise.all([
                        admin.save(),
                        new Transaction({ userId: admin._id, tipo: 'Pagamento Indicação', descricao: `Bônus Boas-Vindas para ${nome}`, valor: -250 }).save()
                    ]);
                } else {
                    referrer.saldo += 250;
                    await Promise.all([
                        referrer.save(),
                        admin.save(),
                        new Transaction({ userId: referrer._id, tipo: 'Bônus de Indicação', descricao: `Convite ${nome}`, valor: 250 }).save(),
                        new Transaction({ userId: admin._id, tipo: 'Pagamento Indicação', descricao: `Bônus ${referrer.nome} e ${nome}`, valor: -500 }).save()
                    ]);
                }
            }
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

app.post('/api/auth/google', async (req, res) => {
    if (!googleClient) return res.status(500).json({ sucesso: false, mensagem: "Google Login não configurado." });
    
    const { credential, codigoIndicacao } = req.body;
    if (!credential) return res.status(400).json({ sucesso: false, mensagem: "Token inválido." });

    try {
        const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        let user = await User.findOne({ email: payload.email });
        
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
            if (referrer && admin) {
                const isCeoReferrer = referrer.email === ADMIN_EMAIL;
                const custoAdmin = isCeoReferrer ? 250 : 500;

                if (admin.saldo >= custoAdmin) {
                    saldoInicial = 250;
                    indicadoPorId = referrer._id;
                    admin.saldo -= custoAdmin;

                    if (isCeoReferrer) {
                        await Promise.all([
                            admin.save(),
                            new Transaction({ userId: admin._id, tipo: 'Pagamento Indicação', descricao: `Bônus Boas-Vindas (Google) para ${payload.name}`, valor: -250 }).save()
                        ]);
                    } else {
                        referrer.saldo += 250;
                        await Promise.all([
                            referrer.save(),
                            admin.save(),
                            new Transaction({ userId: referrer._id, tipo: 'Bônus de Indicação', descricao: `Google (${payload.name})`, valor: 250 }).save(),
                            new Transaction({ userId: admin._id, tipo: 'Pagamento Indicação', descricao: `Bônus ${referrer.nome} e ${payload.name}`, valor: -500 }).save()
                        ]);
                    }
                }
            }
            user = new User({ nome: payload.name, email: payload.email, senha: senhaHash, saldo: saldoInicial, codigoIndicacao: novoCodigoUnico, indicadoPor: indicadoPorId });
            await user.save();
            if (saldoInicial > 0) { await new Transaction({ userId: user._id, tipo: 'Bônus de Boas-Vindas', descricao: `Google`, valor: 250 }).save(); }
        }
        
        req.session.user = { id: user._id, nome: user.nome, email: user.email };
        res.json({ sucesso: true, redirecionar: '/dashboard.html' });
    } catch (error) { res.status(401).json({ sucesso: false, mensagem: "Erro Auth." }); }
});

app.use('/api/investimentos', checkAuthenticated, investimentosRoutes);

app.get('/api/dados-dashboard', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const produtos = await Product.find({});
        const settings = await SysSettings.findOne() || new SysSettings();
        const scRate = settings.scPorReal;

        if (!user.codigoIndicacao) { user.codigoIndicacao = crypto.randomBytes(3).toString('hex').toUpperCase(); await user.save(); }
        if (user.statusSocio === 'Ativo' && user.vencimentoSocio && new Date() > new Date(user.vencimentoSocio)) { user.statusSocio = 'Inadimplente'; await user.save(); }

        const diasPassados = (Date.now() - new Date(user.lastYieldApplied)) / (1000 * 60 * 60 * 24);
        if(user.saldo >= WHALE_THRESHOLD && diasPassados >= 1 && user.email !== ADMIN_EMAIL) {
            const diasInteiros = Math.floor(diasPassados);
            const rendimentoGanho = diasInteiros * WHALE_YIELD_PER_DAY;
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            if (admin && admin.saldo >= rendimentoGanho) {
                admin.saldo -= rendimentoGanho; user.saldo += rendimentoGanho; user.lastYieldApplied = Date.now();
                await Promise.all([
                    user.save(), 
                    admin.save(), 
                    new Transaction({ userId: user._id, tipo: 'Rendimento Automático', descricao: `Rendimento de ${diasInteiros} dia(s)`, valor: rendimentoGanho }).save(),
                    new Transaction({ userId: admin._id, tipo: 'Pagamento Rendimento Automático', descricao: `Para ${user.nome} (${diasInteiros} dia(s))`, valor: -rendimentoGanho }).save()
                ]);
            }
        }

        let equippedNftData = null;
        const equippedNft = await NftItem.findOne({ ownerId: user._id, isEquipped: true });
        
        if (equippedNft) {
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            const farmTrait = equippedNft.metadata.attributes.find(a => a.trait_type === "Farm (SolidCoin/Dia)");
            const rechargeTrait = equippedNft.metadata.attributes.find(a => a.trait_type === "Taxa de Recarga");
            
            if (farmTrait && admin) {
                const scPorDia = parseFloat(farmTrait.value);
                const descBateriaPorDia = rechargeTrait ? parseFloat(rechargeTrait.value) : 10;
                
                const diasPassadosNft = (Date.now() - new Date(equippedNft.lastFarmDate)) / (1000 * 60 * 60 * 24);
                const diasInteirosNft = Math.floor(diasPassadosNft);

                if (diasInteirosNft >= 1 && equippedNft.battery > 0) {
                    const maxDiasPossiveis = Math.floor(equippedNft.battery / descBateriaPorDia);
                    const diasReais = Math.min(diasInteirosNft, maxDiasPossiveis);

                    if (diasReais > 0) {
                        const ganhoNft = diasReais * scPorDia;
                        if (user.email !== ADMIN_EMAIL) {
                            if (admin.saldo >= ganhoNft) {
                                admin.saldo -= ganhoNft;
                                user.saldo += ganhoNft;
                                equippedNft.battery -= (diasReais * descBateriaPorDia);
                                if (equippedNft.battery < 0) equippedNft.battery = 0;
                                equippedNft.lastFarmDate = Date.now();

                                await Promise.all([
                                    user.save(), 
                                    admin.save(), 
                                    equippedNft.save(),
                                    new Transaction({ userId: user._id, tipo: 'Farm NFT (Diário)', descricao: `${equippedNft.metadata.name}`, valor: ganhoNft }).save(),
                                    new Transaction({ userId: admin._id, tipo: 'Pagamento Farm NFT', descricao: `${equippedNft.metadata.name} (Para ${user.nome})`, valor: -ganhoNft }).save()
                                ]);
                            }
                        } else {
                            equippedNft.battery -= (diasReais * descBateriaPorDia);
                            if (equippedNft.battery < 0) equippedNft.battery = 0;
                            equippedNft.lastFarmDate = Date.now();
                            await equippedNft.save();
                        }
                    }
                }
            }
            const rarityAttr = equippedNft.metadata.attributes.find(a => a.trait_type === "Classificação" || a.trait_type === "Rarity");
            equippedNftData = { 
                id: equippedNft._id, imageUrl: equippedNft.imageUrl, name: equippedNft.metadata.name, 
                battery: equippedNft.battery, rarity: rarityAttr ? rarityAttr.value : "Comum" 
            };
        }

        const imagensConfig = await ImagemConfig.find({});
        let planosDinamicos = JSON.parse(JSON.stringify(PLANOS_SOCIO));
        
        imagensConfig.forEach(img => {
            if (img.chave.startsWith('plano_') && img.url) {
                const planoNome = img.chave.replace('plano_', '');
                if (planosDinamicos[planoNome]) planosDinamicos[planoNome].imagemUrl = img.url;
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
                jaUsouCodigo: !!user.indicadoPor,
                equippedNft: equippedNftData
            },
            marketplace: produtos.map(p => ({ id: p._id, nome: p.nome, preco: p.preco, imagemUrl: p.imagemUrl, categoria: p.categoria || 'Cédulas' }))
        });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

// =========================================================================
// --- ROTAS DO JOGO SOLIDCRUSH SAGA (VIDA DEVOLVIDA NA VITÓRIA + RANKING) ---
// =========================================================================

async function obterPerfilJogo(userId) {
    let profile = await GameProfile.findOne({ userId });
    if (!profile) {
        profile = await new GameProfile({ userId, level: 1, accumulatedPoints: 0, lives: GAME_MAX_LIVES }).save();
    } else {
        const horasPassadas = (Date.now() - new Date(profile.lastLifeReset).getTime()) / (1000 * 60 * 60);
        if (horasPassadas >= 24 && profile.lives < GAME_MAX_LIVES) {
            profile.lives = GAME_MAX_LIVES;
            profile.lastLifeReset = Date.now();
            await profile.save();
        }
    }
    return profile;
}

app.get('/api/game/status', checkAuthenticated, async (req, res) => {
    try {
        const profile = await obterPerfilJogo(req.session.user.id);
        res.json({
            sucesso: true,
            level: profile.level,
            accumulatedPoints: profile.accumulatedPoints,
            totalPointsEarned: profile.totalPointsEarned,
            totalScWon: profile.totalScWon,
            lives: profile.lives,
            maxLives: GAME_MAX_LIVES,
            pointsTarget: GAME_POINTS_TARGET,
            scReward: GAME_SC_REWARD,
            refillCost: GAME_REFILL_COST_SC,
            boosterCost: GAME_BOOSTER_MOVES_COST
        });
    } catch (e) {
        res.status(500).json({ sucesso: false, mensagem: "Erro ao carregar dados do SolidCrush." });
    }
});

app.get('/api/game/ranking', checkAuthenticated, async (req, res) => {
    try {
        const topProfiles = await GameProfile.find({})
            .sort({ level: -1, totalPointsEarned: -1 })
            .limit(10)
            .populate('userId', 'nome')
            .lean();

        const ranking = topProfiles
            .filter(p => p.userId)
            .map((p, idx) => ({
                posicao: idx + 1,
                nome: p.userId.nome || 'Investidor',
                level: p.level || 1,
                totalPointsEarned: p.totalPointsEarned || 0,
                totalScWon: p.totalScWon || 0
            }));

        res.json({ sucesso: true, ranking });
    } catch (e) {
        res.status(500).json({ sucesso: false, mensagem: "Erro ao carregar ranking." });
    }
});

app.post('/api/game/iniciar-nivel', checkAuthenticated, async (req, res) => {
    try {
        const profile = await obterPerfilJogo(req.session.user.id);
        if (profile.lives <= 0) {
            return res.status(400).json({
                sucesso: false,
                mensagem: `Suas vidas acabaram! Aguarde a renovação gratuita de 24h ou recarregue 5 vidas por ${GAME_REFILL_COST_SC} SC.`
            });
        }
        profile.lives -= 1;
        await profile.save();
        res.json({ sucesso: true, lives: profile.lives, level: profile.level });
    } catch (e) {
        res.status(500).json({ sucesso: false, mensagem: "Erro ao iniciar nível." });
    }
});

app.post('/api/game/finalizar-nivel', checkAuthenticated, async (req, res) => {
    try {
        const { pontosObtidos, venceu } = req.body;
        const profile = await obterPerfilJogo(req.session.user.id);

        if (!venceu) {
            return res.json({
                sucesso: true,
                mensagem: "Fim dos movimentos! Você perdeu 1 vida. Tente novamente!",
                level: profile.level,
                accumulatedPoints: profile.accumulatedPoints,
                lives: profile.lives
            });
        }

        const segundosDesdeUltima = (Date.now() - new Date(profile.lastLevelCompletedAt).getTime()) / 1000;
        if (segundosDesdeUltima < 12) {
            return res.status(400).json({ sucesso: false, mensagem: "Aguarde alguns segundos! Partida finalizada rápido demais." });
        }

        if (profile.lives < GAME_MAX_LIVES) {
            profile.lives += 1;
        }

        const tetoMaximoFase = 12000 + (profile.level * 35);
        let pontosValidos = Math.max(100, Math.min(parseInt(pontosObtidos) || 0, tetoMaximoFase));

        profile.accumulatedPoints += pontosValidos;
        profile.totalPointsEarned += pontosValidos;
        profile.lastLevelCompletedAt = Date.now();

        if (profile.level < GAME_MAX_LEVEL) {
            profile.level += 1;
        }

        const user = await User.findById(req.session.user.id);
        const admin = await User.findOne({ email: ADMIN_EMAIL });
        let scGanhosAgora = 0;

        while (profile.accumulatedPoints >= GAME_POINTS_TARGET) {
            if (admin && admin.saldo >= GAME_SC_REWARD && user.email !== ADMIN_EMAIL) {
                profile.accumulatedPoints -= GAME_POINTS_TARGET;
                profile.totalScWon += GAME_SC_REWARD;
                user.saldo += GAME_SC_REWARD;
                admin.saldo -= GAME_SC_REWARD;
                scGanhosAgora += GAME_SC_REWARD;

                await Promise.all([
                    new Transaction({ userId: user._id, tipo: 'Prêmio SolidCrush Saga', descricao: `Meta de 1.000.000 pts atingida!`, valor: GAME_SC_REWARD }).save(),
                    new Transaction({ userId: admin._id, tipo: 'Pagamento Prêmio SolidCrush', descricao: `Para ${user.nome} (1.000.000 pts)`, valor: -GAME_SC_REWARD }).save()
                ]);
            } else if (user.email === ADMIN_EMAIL) {
                profile.accumulatedPoints -= GAME_POINTS_TARGET;
                profile.totalScWon += GAME_SC_REWARD;
                scGanhosAgora += GAME_SC_REWARD;
            } else {
                break;
            }
        }

        await Promise.all([profile.save(), user.save(), admin ? admin.save() : Promise.resolve()]);

        let msgRetorno = `🎉 Nível concluído! Sua vida foi mantida e +${pontosValidos.toLocaleString('pt-BR')} pontos foram somados.`;
        if (scGanhosAgora > 0) {
            msgRetorno = `🏆 INCRÍVEL! Você atingiu 1.000.000 de pontos e ganhou +${scGanhosAgora} SolidCoins na sua conta!`;
        }

        res.json({
            sucesso: true,
            mensagem: msgRetorno,
            level: profile.level,
            accumulatedPoints: profile.accumulatedPoints,
            totalPointsEarned: profile.totalPointsEarned,
            totalScWon: profile.totalScWon,
            lives: profile.lives,
            novoSaldo: user.saldo,
            scGanhosAgora
        });
    } catch (e) {
        res.status(500).json({ sucesso: false, mensagem: "Erro ao registrar pontuação." });
    }
});

app.post('/api/game/recarregar-vidas', checkAuthenticated, async (req, res) => {
    try {
        const profile = await obterPerfilJogo(req.session.user.id);
        if (profile.lives >= GAME_MAX_LIVES) {
            return res.status(400).json({ sucesso: false, mensagem: "Suas vidas já estão cheias!" });
        }

        const user = await User.findById(req.session.user.id);
        const admin = await User.findOne({ email: ADMIN_EMAIL });

        if (user.saldo < GAME_REFILL_COST_SC) {
            return res.status(400).json({ sucesso: false, mensagem: `Saldo insuficiente! Custa ${GAME_REFILL_COST_SC} SC para recarregar 5 vidas.` });
        }

        user.saldo -= GAME_REFILL_COST_SC;
        profile.lives = GAME_MAX_LIVES;
        profile.lastLifeReset = Date.now();

        const promessas = [
            user.save(),
            profile.save(),
            new Transaction({ userId: user._id, tipo: 'Recarga Vidas SolidCrush', descricao: '5 Vidas no Jogo SolidCrush', valor: -GAME_REFILL_COST_SC }).save()
        ];

        if (admin && user.email !== ADMIN_EMAIL) {
            admin.saldo += GAME_REFILL_COST_SC;
            promessas.push(admin.save());
            promessas.push(new Transaction({ userId: admin._id, tipo: 'Recebimento SolidCrush', descricao: `Recarga de Vidas (${user.nome})`, valor: GAME_REFILL_COST_SC }).save());
        }

        await Promise.all(promessas);
        res.json({ sucesso: true, mensagem: "❤️ Suas 5 vidas foram recarregadas com sucesso!", lives: profile.lives, novoSaldo: user.saldo });
    } catch (e) {
        res.status(500).json({ sucesso: false, mensagem: "Erro ao recarregar vidas." });
    }
});

app.post('/api/game/comprar-movimentos', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const admin = await User.findOne({ email: ADMIN_EMAIL });

        if (user.saldo < GAME_BOOSTER_MOVES_COST) {
            return res.status(400).json({ sucesso: false, mensagem: `Saldo insuficiente! Custa ${GAME_BOOSTER_MOVES_COST} SC para adicionar +5 movimentos.` });
        }

        user.saldo -= GAME_BOOSTER_MOVES_COST;
        const promessas = [
            user.save(),
            new Transaction({ userId: user._id, tipo: 'Booster SolidCrush', descricao: '+5 Movimentos Extras no Jogo', valor: -GAME_BOOSTER_MOVES_COST }).save()
        ];

        if (admin && user.email !== ADMIN_EMAIL) {
            admin.saldo += GAME_BOOSTER_MOVES_COST;
            promessas.push(admin.save());
            promessas.push(new Transaction({ userId: admin._id, tipo: 'Recebimento SolidCrush', descricao: `Booster Movimentos (${user.nome})`, valor: GAME_BOOSTER_MOVES_COST }).save());
        }

        await Promise.all(promessas);
        res.json({ sucesso: true, mensagem: "⚡ +5 Movimentos adicionados!", novoSaldo: user.saldo });
    } catch (e) {
        res.status(500).json({ sucesso: false, mensagem: "Erro ao comprar movimentos." });
    }
});

// =========================================================================
// --- ROTAS DO MARKETPLACE NFT + MINT NA BLOCKCHAIN CELO (SOLIDNFT) ---
// =========================================================================

app.get('/api/admin/nft-configs', isAdmin, async (req, res) => {
    try {
        let settings = await SysSettings.findOne();
        res.json({ sucesso: true, prices: settings.nftPrices });
    } catch(e) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/nft-configs', isAdmin, async (req, res) => {
    try {
        let settings = await SysSettings.findOne() || new SysSettings();
        settings.nftPrices = { ...settings.nftPrices, ...req.body.prices };
        await settings.save();
        res.json({ sucesso: true, mensagem: "Preços de Mintagem atualizados!" });
    } catch(e) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/nft-templates', isAdmin, async (req, res) => {
    try {
        const { imageUrl, metadataJson } = req.body;
        const metadata = JSON.parse(metadataJson);
        const rarityAttr = metadata.attributes.find(a => a.trait_type === "Classificação" || a.trait_type === "Rarity");
        const rarity = rarityAttr ? rarityAttr.value : "Comum";

        const novoTemplate = await new NftTemplate({ imageUrl, metadata, rarity, ativo: true }).save();
        novoTemplate.tokenUri = `https://www.solidcoincommunity.com/api/nfts/metadata/${novoTemplate._id}.json`;
        await novoTemplate.save();

        res.json({ sucesso: true, mensagem: "NFT adicionado ao catálogo para Mintagem!" });
    } catch(e) { res.status(400).json({ sucesso: false, mensagem: "Erro. Verifique se o JSON é válido." }); }
});

app.post('/api/admin/nft-importar-ipfs', isAdmin, async (req, res) => {
    try {
        const { ipfsUrl, qtd } = req.body;
        const quantidade = parseInt(qtd);

        if (!ipfsUrl || !quantidade || quantidade <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: "Forneça o Link da Pasta do Pinata e a quantidade de NFTs." });
        }

        let rawFolder = ipfsUrl.trim();
        if (rawFolder.endsWith('/')) rawFolder = rawFolder.slice(0, -1);

        let baseUrl = rawFolder;
        if (baseUrl.startsWith('ipfs://')) {
            baseUrl = baseUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }

        let importados = 0;
        let erros = 0;

        for (let i = 1; i <= quantidade; i++) {
            try {
                const jsonGatewayUrl = `${baseUrl}/${i}.json`;
                const response = await fetch(jsonGatewayUrl);
                if (!response.ok) {
                    erros++;
                    continue;
                }

                const metadata = await response.json();
                
                let imgUrl = metadata.image || '';
                if (imgUrl.startsWith('ipfs://')) {
                    imgUrl = imgUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
                }

                const rarityAttr = metadata.attributes.find(a => a.trait_type === "Classificação" || a.trait_type === "Rarity");
                const rarity = rarityAttr ? rarityAttr.value : "Comum";

                const novoTemplate = await new NftTemplate({ imageUrl: imgUrl, metadata, rarity, ativo: true }).save();
                novoTemplate.tokenUri = `https://www.solidcoincommunity.com/api/nfts/metadata/${novoTemplate._id}.json`;
                await novoTemplate.save();

                importados++;
            } catch (errLoop) {
                erros++;
            }
        }

        res.json({ sucesso: true, mensagem: `Importação concluída! Sucesso: ${importados} NFTs. Erros: ${erros}.` });
    } catch(e) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro no servidor ao tentar importar do IPFS." }); 
    }
});

app.get('/api/admin/nft-templates', isAdmin, async (req, res) => {
    try {
        const templates = await NftTemplate.find().lean();
        const itemsMintados = await NftItem.find().populate('ownerId', 'nome email').lean();

        const templatesComProprietario = templates.map(t => {
            const item = itemsMintados.find(i => 
                (i.templateId && i.templateId.toString() === t._id.toString()) || 
                (i.metadata && t.metadata && i.metadata.name === t.metadata.name)
            );
            let donoNome = "Disponível (Não Mintado)";
            let donoEmail = "";
            let jaMintado = false;

            if (item && item.ownerId) {
                jaMintado = true;
                donoNome = item.ownerId.nome;
                donoEmail = item.ownerId.email;
            } else if (t.ativo === false) {
                jaMintado = true;
                donoNome = "Mintado na Blockchain Celo (Retirado da Plataforma)";
            }

            return {
                ...t,
                jaMintado,
                donoNome,
                donoEmail
            };
        });

        res.json({ sucesso: true, templates: templatesComProprietario });
    } catch(e) { res.status(500).json({ sucesso: false }); }
});

app.delete('/api/admin/nft-templates/:id', isAdmin, async (req, res) => {
    try {
        await NftTemplate.findByIdAndDelete(req.params.id);
        res.json({ sucesso: true, mensagem: "NFT removido do catálogo." });
    } catch(e) { res.status(500).json({ sucesso: false }); }
});

app.get('/api/nfts/disponiveis', checkAuthenticated, async (req, res) => {
    try {
        const itensMintados = await NftItem.find({}).select('templateId metadata.name').lean();
        const idsMintados = itensMintados.map(i => i.templateId ? i.templateId.toString() : null).filter(Boolean);
        const nomesMintados = itensMintados.map(i => i.metadata && i.metadata.name ? i.metadata.name : null).filter(Boolean);

        if (idsMintados.length > 0 || nomesMintados.length > 0) {
            await NftTemplate.updateMany(
                { 
                    $or: [
                        { _id: { $in: idsMintados } }, 
                        { 'metadata.name': { $in: nomesMintados } }
                    ], 
                    ativo: true 
                },
                { $set: { ativo: false } }
            );
        }

        const templates = await NftTemplate.find({ 
            ativo: true,
            _id: { $nin: idsMintados },
            'metadata.name': { $nin: nomesMintados }
        });
        const settings = await SysSettings.findOne();
        const prices = settings.nftPrices;
        res.json({ sucesso: true, templates, prices });
    } catch(e) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/nfts/mintar', checkAuthenticated, async (req, res) => {
    try {
        const { templateId } = req.body;
        const template = await NftTemplate.findById(templateId);
        
        if (!template) {
            return res.status(404).json({ sucesso: false, mensagem: "NFT não encontrado." });
        }

        const jaExiste = await NftItem.findOne({
            $or: [
                { templateId: template._id },
                { 'metadata.name': template.metadata.name }
            ]
        });

        if (!template.ativo || jaExiste) {
            await NftTemplate.updateMany({ 'metadata.name': template.metadata.name }, { $set: { ativo: false } });
            return res.status(400).json({ sucesso: false, mensagem: "Este NFT é único e já foi adquirido por outro usuário!" });
        }

        const settings = await SysSettings.findOne();
        const price = settings.nftPrices[template.rarity];

        const user = await User.findById(req.session.user.id);
        const admin = await User.findOne({ email: ADMIN_EMAIL });

        const limiteDisponivel = await calcularLimiteSaque(user._id, user.saldo, user.email);
        if (price > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Saldo bloqueado pelo vesting! Saldo livre disponível: ${limiteDisponivel.toFixed(2)} SC.` });

        user.saldo -= price;
        admin.saldo += price;

        const maxBatteryAttr = template.metadata.attributes.find(a => a.trait_type === "Carga Máxima de Bateria");
        const maxBattery = maxBatteryAttr ? maxBatteryAttr.value : 100;

        const linkJsonBanco = `https://www.solidcoincommunity.com/api/nfts/metadata/${template._id}.json`;

        const newItem = new NftItem({
            templateId: template._id,
            ownerId: user._id,
            imageUrl: template.imageUrl,
            tokenUri: linkJsonBanco,
            metadata: template.metadata,
            mintPrice: price,
            battery: maxBattery
        });

        await Promise.all([
            user.save(), 
            admin.save(), 
            NftTemplate.updateMany({ $or: [{ _id: template._id }, { 'metadata.name': template.metadata.name }] }, { $set: { ativo: false } }),
            newItem.save(),
            new Transaction({ userId: user._id, tipo: 'Mint NFT', descricao: template.metadata.name, valor: -price }).save(),
            new Transaction({ userId: admin._id, tipo: 'Venda NFT (Mint)', descricao: `Para ${user.nome}`, valor: price }).save()
        ]);

        res.json({ sucesso: true, mensagem: `Você mintou o NFT exclusivo ${template.metadata.name} na plataforma! Agora você pode usá-lo aqui ou enviá-lo para a Blockchain Celo no seu Inventário.` });
    } catch(e) { res.status(500).json({ sucesso: false, mensagem: "Erro ao mintar NFT." }); }
});

// Mintar o NFT do Inventário para a Blockchain Celo usando o JSON que já está salvo no MongoDB
app.post('/api/nfts/mintar-blockchain', checkAuthenticated, async (req, res) => {
    try {
        const { nftId, walletAddress } = req.body;
        if (!walletAddress) {
            return res.status(400).json({ sucesso: false, mensagem: "Conecte sua carteira MetaMask primeiro." });
        }

        if (!celoWallet || !solidNftContract || !slcContract) {
            return res.status(500).json({ sucesso: false, mensagem: "Carteira Admin Celo não configurada no servidor (MINIPAY_PRIVATE_KEY ou MINIPAY_SEED_PHRASE)." });
        }

        const { ethers } = require('ethers');
        const enderecoLimpo = walletAddress.trim();
        const isAddrValid = ethers.isAddress ? ethers.isAddress(enderecoLimpo) : ethers.utils.isAddress(enderecoLimpo);
        if (!isAddrValid) {
            return res.status(400).json({ sucesso: false, mensagem: "Endereço da carteira Celo inválido." });
        }

        const nft = await NftItem.findOne({ _id: nftId, ownerId: req.session.user.id });
        if (!nft) {
            return res.status(404).json({ sucesso: false, mensagem: "NFT não encontrado no seu inventário." });
        }
        if (nft.isForSale) {
            return res.status(400).json({ sucesso: false, mensagem: "Cancele a venda do NFT no mercado antes de enviá-lo para a Blockchain." });
        }

        const rarityAttr = nft.metadata && nft.metadata.attributes 
            ? nft.metadata.attributes.find(a => a.trait_type === "Classificação" || a.trait_type === "Rarity")
            : null;
        let rarity = rarityAttr ? String(rarityAttr.value).trim() : "Comum";
        if (rarity === "Lendário") rarity = "Lendario";

        const precosContrato = {
            Comum: "1600",
            Incomum: "3200",
            Raro: "8000",
            Lendario: "16000"
        };
        const precoStr = precosContrato[rarity] || "1600";

        const parseUnitsFn = ethers.parseUnits ? ethers.parseUnits : ethers.utils.parseUnits;
        const precoWei = parseUnitsFn(precoStr, 18);

        // 1. Verifica se o usuário já aprovou (approve) o contrato SolidNFT no token SLC
        const allowanceAtual = await slcContract.allowance(enderecoLimpo, SOLIDNFT_CELO_ADDRESS);
        const temAllowance = (typeof allowanceAtual === 'bigint') 
            ? (allowanceAtual >= precoWei) 
            : allowanceAtual.gte(precoWei);

        if (!temAllowance) {
            return res.status(400).json({
                sucesso: false,
                precisaApprove: true,
                precoRequerido: precoStr,
                mensagem: `Autorize primeiro o contrato SolidNFT na sua MetaMask para validar o envio de ${precoStr} SLC.`
            });
        }

        // 2. Garante que a carteira Web3 do usuário tenha as SLC necessárias para o transferFrom do contrato SolidNFT
        const saldoSlcUsuario = await slcContract.balanceOf(enderecoLimpo);
        const temSaldoOnChain = (typeof saldoSlcUsuario === 'bigint')
            ? (saldoSlcUsuario >= precoWei)
            : saldoSlcUsuario.gte(precoWei);

        if (!temSaldoOnChain) {
            const diferencaWei = (typeof saldoSlcUsuario === 'bigint')
                ? (precoWei - saldoSlcUsuario)
                : precoWei.sub(saldoSlcUsuario);
            
            const txFunding = await slcContract.transfer(enderecoLimpo, diferencaWei);
            await txFunding.wait();
        }

        // 3. Garante que o Template com o JSON e a Imagem permaneça salvo no MongoDB e gera o linkExato direto do Banco de Dados!
        let templateDoc = null;
        if (nft.templateId) {
            templateDoc = await NftTemplate.findById(nft.templateId);
        }
        if (!templateDoc && nft.metadata && nft.metadata.name) {
            templateDoc = await NftTemplate.findOne({ 'metadata.name': nft.metadata.name });
        }
        if (!templateDoc) {
            templateDoc = await new NftTemplate({
                imageUrl: nft.imageUrl,
                metadata: nft.metadata,
                rarity: rarity,
                ativo: false
            }).save();
        } else if (templateDoc.ativo !== false) {
            templateDoc.ativo = false;
            await templateDoc.save();
        }

        // Este linkExato entrega o JSON completo e a imagem salvos no seu MongoDB para o contrato na Blockchain Celo!
        const hostUrl = `${req.protocol}://${req.get('host')}`;
        const linkExato = `${hostUrl}/api/nfts/metadata/${templateDoc._id}.json`;

        // 4. Aciona a função exata do contrato SolidNFT de acordo com a raridade
        let txMint;
        if (rarity === "Lendario") {
            txMint = await solidNftContract.adminMintLendario(enderecoLimpo, linkExato);
        } else if (rarity === "Raro") {
            txMint = await solidNftContract.adminMintRaro(enderecoLimpo, linkExato);
        } else if (rarity === "Incomum") {
            txMint = await solidNftContract.adminMintIncomum(enderecoLimpo, linkExato);
        } else {
            txMint = await solidNftContract.adminMintComum(enderecoLimpo, linkExato);
        }

        await txMint.wait();

        // 5. Remove o NFT do inventário da plataforma (pois o NftTemplate continua salvo no banco servindo o JSON para a Blockchain)
        await NftItem.findByIdAndDelete(nft._id);

        await new Transaction({
            userId: req.session.user.id,
            tipo: 'Mint NFT na Blockchain (Celo)',
            descricao: `${nft.metadata.name} -> Carteira ${enderecoLimpo.slice(0, 6)}...${enderecoLimpo.slice(-4)}`,
            valor: 0
        }).save();

        res.json({
            sucesso: true,
            txHash: txMint.hash,
            tokenUri: linkExato,
            mensagem: `🎉 Sucesso! O ${nft.metadata.name} foi mintado oficialmente na Blockchain Celo com o JSON do seu banco de dados e retirado da plataforma!`
        });
    } catch (err) {
        console.error("Erro ao mintar NFT na Blockchain Celo:", err);
        const detalhe = err.shortMessage || err.reason || err.message || "Falha na transação Web3.";
        res.status(500).json({
            sucesso: false,
            mensagem: `Erro ao mintar na Blockchain Celo: ${detalhe}`
        });
    }
});

app.get('/api/nfts/meus', checkAuthenticated, async (req, res) => {
    try {
        const nfts = await NftItem.find({ ownerId: req.session.user.id }).sort({ mintDate: -1 });
        res.json({ sucesso: true, nfts });
    } catch(e) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/nfts/equipar', checkAuthenticated, async (req, res) => {
    try {
        const { nftId } = req.body;
        const nft = await NftItem.findOne({ _id: nftId, ownerId: req.session.user.id });
        if (!nft) return res.status(404).json({ sucesso: false, mensagem: "NFT não encontrado na sua carteira." });
        if (nft.isForSale) return res.status(400).json({ sucesso: false, mensagem: "Você não pode equipar um NFT que está à venda." });

        await NftItem.updateMany({ ownerId: req.session.user.id, isEquipped: true }, { $set: { isEquipped: false } });
        
        nft.isEquipped = true;
        nft.lastFarmDate = Date.now();
        await nft.save();

        res.json({ sucesso: true, mensagem: "NFT equipado com sucesso no seu perfil!" });
    } catch(e) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/nfts/desequipar', checkAuthenticated, async (req, res) => {
    try {
        const { nftId } = req.body;
        const nft = await NftItem.findOne({ _id: nftId, ownerId: req.session.user.id });
        if (!nft) return res.status(404).json({ sucesso: false, mensagem: "NFT não encontrado na sua carteira." });

        nft.isEquipped = false;
        await nft.save();

        res.json({ sucesso: true, mensagem: "NFT retirado do perfil com sucesso! Agora você pode vendê-lo, equipar outro ou enviá-lo para a Blockchain." });
    } catch(e) { res.status(500).json({ sucesso: false, mensagem: "Erro ao desequipar NFT." }); }
});

app.post('/api/nfts/vender', checkAuthenticated, async (req, res) => {
    try {
        const { nftId, price } = req.body;
        const priceNum = parseFloat(price);

        const nft = await NftItem.findOne({ _id: nftId, ownerId: req.session.user.id });
        if (!nft) return res.status(404).json({ sucesso: false, mensagem: "NFT não encontrado." });
        
        if (nft.isEquipped) return res.status(400).json({ sucesso: false, mensagem: "Desequipe o NFT do seu perfil primeiro." });
        if (priceNum < nft.mintPrice) return res.status(400).json({ sucesso: false, mensagem: `O sistema protege o valor. Mínimo: ${nft.mintPrice} SC.` });

        nft.isForSale = true;
        nft.salePrice = priceNum;
        await nft.save();

        res.json({ sucesso: true, mensagem: "NFT listado no Marketplace com sucesso!" });
    } catch(e) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/nfts/cancelar-venda', checkAuthenticated, async (req, res) => {
    try {
        const nft = await NftItem.findOne({ _id: req.body.nftId, ownerId: req.session.user.id });
        if (!nft) return res.status(404).json({ sucesso: false });
        nft.isForSale = false; nft.salePrice = 0; await nft.save();
        res.json({ sucesso: true, mensagem: "Venda cancelada." });
    } catch(e) { res.status(500).json({ sucesso: false }); }
});

app.get('/api/nfts/marketplace', checkAuthenticated, async (req, res) => {
    try {
        const nfts = await NftItem.find({ isForSale: true, ownerId: { $ne: req.session.user.id } }).populate('ownerId', 'nome');
        res.json({ sucesso: true, nfts });
    } catch(e) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/nfts/comprar', checkAuthenticated, async (req, res) => {
    try {
        const { nftId } = req.body;
        const nft = await NftItem.findById(nftId);
        
        if (!nft || !nft.isForSale) return res.status(400).json({ sucesso: false, mensagem: "NFT não disponível." });
        if (nft.ownerId.toString() === req.session.user.id) return res.status(400).json({ sucesso: false, mensagem: "Você já é o dono." });

        const comprador = await User.findById(req.session.user.id);
        const vendedor = await User.findById(nft.ownerId);
        
        const limiteDisponivel = await calcularLimiteSaque(comprador._id, comprador.saldo, comprador.email);
        if (nft.salePrice > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Saldo livre disponível: ${limiteDisponivel.toFixed(2)} SC.` });

        comprador.saldo -= nft.salePrice; vendedor.saldo += nft.salePrice;
        
        nft.ownerId = comprador._id;
        nft.isForSale = false;
        nft.isEquipped = false;
        nft.salePrice = 0;

        await Promise.all([
            comprador.save(), vendedor.save(), nft.save(),
            new Transaction({ userId: comprador._id, tipo: 'Compra NFT (Mercado)', descricao: nft.metadata.name, valor: -nft.salePrice }).save(),
            new Transaction({ userId: vendedor._id, tipo: 'Venda NFT (Mercado)', descricao: `Para ${comprador.nome}`, valor: nft.salePrice }).save()
        ]);

        res.json({ sucesso: true, mensagem: "NFT comprado com sucesso!" });
    } catch(e) { res.status(500).json({ sucesso: false, mensagem: "Erro na compra." }); }
});

app.post('/api/nfts/recarregar', checkAuthenticated, async (req, res) => {
    try {
        const { nftId } = req.body;
        const nft = await NftItem.findOne({ _id: nftId, ownerId: req.session.user.id });
        
        if (!nft) return res.status(404).json({ sucesso: false, mensagem: "NFT não encontrado." });

        const maxBatteryAttr = nft.metadata.attributes.find(a => a.trait_type === "Carga Máxima de Bateria");
        const maxBattery = maxBatteryAttr ? parseFloat(maxBatteryAttr.value) : 100;

        if (nft.battery >= maxBattery) {
            return res.status(400).json({ sucesso: false, mensagem: "A bateria do NFT já está completamente carregada!" });
        }

        const user = await User.findById(req.session.user.id);
        const admin = await User.findOne({ email: ADMIN_EMAIL });

        const limiteDisponivel = await calcularLimiteSaque(user._id, user.saldo, user.email);
        if (CUSTO_RECARGA_NFT > limiteDisponivel) {
            return res.status(400).json({ sucesso: false, mensagem: `Saldo livre insuficiente. Custa ${CUSTO_RECARGA_NFT} SC para recarregar.` });
        }

        user.saldo -= CUSTO_RECARGA_NFT;
        if (admin) admin.saldo += CUSTO_RECARGA_NFT;
        
        nft.battery = maxBattery;

        const promessas = [
            user.save(), nft.save(),
            new Transaction({ userId: user._id, tipo: 'Recarga Bateria NFT', descricao: nft.metadata.name, valor: -CUSTO_RECARGA_NFT }).save()
        ];
        
        if (admin) {
            promessas.push(admin.save());
            promessas.push(new Transaction({ userId: admin._id, tipo: 'Taxa Recarga NFT', descricao: `De ${user.nome}`, valor: CUSTO_RECARGA_NFT }).save());
        }

        await Promise.all(promessas);

        res.json({ sucesso: true, mensagem: `⚡ Bateria do NFT recarregada para 100% com sucesso!` });
    } catch(e) { res.status(500).json({ sucesso: false, mensagem: "Erro ao recarregar a bateria." }); }
});

// =========================================================================

app.post('/api/links-referencia/acessar', checkAuthenticated, async (req, res) => {
    try {
        const TAXA_ACESSO = 10;
        const user = await User.findById(req.session.user.id);
        
        if (!user) return res.status(404).json({ sucesso: false, mensagem: "Usuário não encontrado." });
        if (user.saldo < TAXA_ACESSO) return res.status(400).json({ sucesso: false, mensagem: `Saldo insuficiente! Você precisa de ${TAXA_ACESSO} SolidCoins para abrir a página de links.` });

        if (user.email !== ADMIN_EMAIL) {
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            user.saldo -= TAXA_ACESSO;
            const promises = [user.save(), new Transaction({ userId: user._id, tipo: 'Acesso Página de Links', descricao: 'Desbloqueio de Links de Referência', valor: -TAXA_ACESSO }).save()];
            if (admin) {
                admin.saldo += TAXA_ACESSO;
                promises.push(admin.save());
                promises.push(new Transaction({ userId: admin._id, tipo: 'Recebimento Acesso Links', descricao: `Pago por ${user.nome}`, valor: TAXA_ACESSO }).save());
            }
            await Promise.all(promises);
        } else {
            await new Transaction({ userId: user._id, tipo: 'Teste Acesso Links (CEO)', descricao: 'Acesso administrativo aos links', valor: 0 }).save();
        }

        const links = await ReferralLink.find({}).sort({ data: -1 });
        res.json({ sucesso: true, mensagem: "✅ Acesso liberado! Foram descontadas 10 SolidCoins.", novoSaldo: user.saldo, links: links });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao liberar página de links." }); }
});

app.get('/api/admin/links-referencia', isAdmin, async (req, res) => {
    try {
        const links = await ReferralLink.find({}).sort({ data: -1 });
        res.json({ sucesso: true, links });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao listar links." }); }
});

app.post('/api/admin/links-referencia/adicionar', isAdmin, async (req, res) => {
    try {
        const { titulo, descricao, url } = req.body;
        if (!titulo || !url || !url.startsWith('http')) return res.status(400).json({ sucesso: false, mensagem: "Preencha o título e uma URL válida." });
        await new ReferralLink({ titulo: titulo.trim(), descricao: (descricao || '').trim(), url: url.trim() }).save();
        res.json({ sucesso: true, mensagem: "✅ Link de referência cadastrado com sucesso!" });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao cadastrar link." }); }
});

app.delete('/api/admin/links-referencia/excluir/:id', isAdmin, async (req, res) => {
    try {
        await ReferralLink.findByIdAndDelete(req.params.id);
        res.json({ sucesso: true, mensagem: "🗑️ Link removido com sucesso!" });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao remover link." }); }
});

app.post('/api/indicacao/resgatar', checkAuthenticated, async (req, res) => {
    try {
        const { codigo } = req.body;
        const user = await User.findById(req.session.user.id);
        if (user.indicadoPor || user.codigoIndicacao === codigo.toUpperCase()) return res.status(400).json({ sucesso: false, mensagem: "Código inválido ou já utilizado." });
        
        const referrer = await User.findOne({ codigoIndicacao: codigo.toUpperCase() });
        const admin = await User.findOne({ email: ADMIN_EMAIL });
        if (!referrer || !admin) return res.status(400).json({ sucesso: false, mensagem: "Código não encontrado." });

        const isCeoReferrer = referrer.email === ADMIN_EMAIL;
        const custoAdmin = isCeoReferrer ? 250 : 500;

        if (admin.saldo < custoAdmin) return res.status(400).json({ sucesso: false, mensagem: "Saldo do sistema indisponível." });

        user.indicadoPor = referrer._id;
        user.saldo += 250;
        admin.saldo -= custoAdmin;

        if (isCeoReferrer) {
            await Promise.all([
                user.save(),
                admin.save(),
                new Transaction({ userId: user._id, tipo: 'Bônus de Boas-Vindas', descricao: `Código de ${referrer.nome}`, valor: 250 }).save(),
                new Transaction({ userId: admin._id, tipo: 'Pagamento Indicação', descricao: `Bônus Boas-Vindas para ${user.nome}`, valor: -250 }).save()
            ]);
        } else {
            referrer.saldo += 250;
            await Promise.all([
                user.save(),
                referrer.save(),
                admin.save(),
                new Transaction({ userId: user._id, tipo: 'Bônus de Boas-Vindas', descricao: `Código de ${referrer.nome}`, valor: 250 }).save(),
                new Transaction({ userId: referrer._id, tipo: 'Bônus de Indicação', descricao: `Você convidou ${user.nome}`, valor: 250 }).save(),
                new Transaction({ userId: admin._id, tipo: 'Pagamento Indicação', descricao: `Para ${referrer.nome} e ${user.nome}`, valor: -500 }).save()
            ]);
        }
        res.json({ sucesso: true, mensagem: "Bônus de 250 SC resgatado com sucesso!", novoSaldo: user.saldo });
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
        
        const limiteDisponivel = await calcularLimiteSaque(remetente._id, remetente.saldo, remetente.email);
        if (valorNum > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Saldo bloqueado pelo vesting de Sócio. Disponível: ${limiteDisponivel.toFixed(2)} SC.` });

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
        
        const limiteDisponivel = await calcularLimiteSaque(pagador._id, pagador.saldo, pagador.email);
        if (valorNum > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Saldo insuficiente no cartão de ${pagador.nome} (moedas bloqueadas).` });

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
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao gerar cobrança Pix na conta PF." }); }
});

app.post('/api/solicitar-saque-pix', checkAuthenticated, async (req, res) => {
    try {
        const { valorSC, tipoChave, chavePix } = req.body;
        const valorNum = parseFloat(valorSC);

        if (!valorNum || valorNum <= 0 || !tipoChave || !chavePix) return res.status(400).json({ sucesso: false, mensagem: "Dados inválidos." });
        if (!efipayPJ) return res.status(500).json({ sucesso: false, mensagem: "A API de Pagamentos PJ não está configurada no servidor." });

        const user = await User.findById(req.session.user.id);
        if (user.statusSocio !== 'Ativo') return res.status(403).json({ sucesso: false, mensagem: "Exclusivo para Sócios ativos." });
        
        const limiteDisponivel = await calcularLimiteSaque(user._id, user.saldo, user.email);
        if (valorNum > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Saque Bloqueado pelo Vesting! Valor 100% livre na conta: ${limiteDisponivel.toFixed(2)} SC.` });

        const chaveFavorecidoLimpa = normalizarChavePix(chavePix, tipoChave);
        const chavePagadorLimpa = normalizarChavePix(process.env.EFI_PIX_KEY_PJ); 

        const scRate = await getSCRate();
        const taxaSC = valorNum * 0.05; 
        const valorLiquidoSC = valorNum - taxaSC;
        const valorBRL = valorLiquidoSC / scRate;
        const idEnvio = crypto.randomBytes(16).toString('hex');

        let bodyEnvioPix = {
            valor: valorBRL.toFixed(2), pagador: { chave: chavePagadorLimpa }, favorecido: { chave: chaveFavorecidoLimpa } 
        };

        try {
            const envioResponse = await efipayPJ.pixSend({ idEnvio: idEnvio }, bodyEnvioPix);
            
            if (envioResponse.status === 'NAO_REALIZADO' || envioResponse.status === 'RECUSADO' || envioResponse.status === 'FALHA') {
                throw new Error('Pix Recusado pelo banco');
            }

            user.saldo -= valorNum;
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            if (admin) admin.saldo += valorNum; 

            const novoSaquePix = new PixWithdrawal({
                userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, chavePix: chaveFavorecidoLimpa, tipoChavePix: tipoChave,
                valorSC: valorNum, taxaSC: taxaSC, valorBRL: valorBRL, status: 'Aprovado', txId: envioResponse.e2eId || envioResponse.idEnvio || idEnvio
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
                valorSC: valorNum, taxaSC: taxaSC, valorBRL: valorBRL, status: 'Pendente', txId: 'Aguardando CEO'
            });

            await Promise.all([
                user.save(), novoSaquePix.save(),
                new Transaction({ userId: user._id, tipo: 'Saque Pix Solicitado', descricao: `Pendente de Aprovação`, valor: -valorNum }).save()
            ]);

            return res.json({ sucesso: true, mensagem: `⚠️ Transação enviada para aprovação do CEO. O pagamento será processado manualmente em breve!` });
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
                            if (referrer && referrer.email !== ADMIN_EMAIL && admin.saldo >= (ordem.moedasReceber * 0.05)) {
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
                            new Transaction({ userId: user._id, tipo: 'Assinatura Sócio SolidCoin', descricao: `Verificado pelo ADM`, valor: ordem.moedasReceber }).save(),
                            new Transaction({ userId: admin._id, tipo: 'Pagamento Sócio', descricao: `Para ${user.nome} (Verificado ADM)`, valor: -ordem.moedasReceber }).save()
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
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: `A Efí PF recusou o cadastro do webhook.` }); }
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
            solanaWallet: req.body.solanaWallet || '', tronWallet: '', minipayWallet: req.body.minipayWallet || '' 
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
        if (metodo === 'Tron') return res.status(400).json({ sucesso: false, mensagem: "Saques pela rede Tron foram desativados. Utilize MiniPay (Rede Celo) ou Solana." });
        
        let carteiraParaSaque = '';
        if (metodo === 'MiniPay') {
            if (!user.minipayWallet) return res.status(400).json({ sucesso: false, mensagem: "Salve sua carteira MiniPay / Celo primeiro."});
            carteiraParaSaque = `MiniPay: ${user.minipayWallet}`;
        } else if (metodo === 'Solana') {
            if (!user.solanaWallet) return res.status(400).json({ sucesso: false, mensagem: "Salve sua carteira Solana primeiro."});
            carteiraParaSaque = `Solana: ${user.solanaWallet}`;
        } else {
            if (!user.solanaWallet && !user.minipayWallet) return res.status(400).json({ sucesso: false, mensagem: "Você precisa salvar uma carteira MiniPay (Celo) ou Solana."});
            carteiraParaSaque = user.minipayWallet ? `MiniPay: ${user.minipayWallet}` : `Solana: ${user.solanaWallet}`;
        }
        
        const limiteDisponivel = await calcularLimiteSaque(user._id, user.saldo, user.email);
        if (valor > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Saque Bloqueado pelo Vesting! Valor livre na conta: ${limiteDisponivel.toFixed(2)} SC.` });

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
        
        const limiteDisponivel = await calcularLimiteSaque(user._id, user.saldo, user.email);
        if (valor > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Operação bloqueada pelo vesting! Saldo livre disponível para aplicar: ${limiteDisponivel.toFixed(2)} SC.` });

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

        const txs = [new Transaction({ userId: user._id, tipo: 'Retorno de Staking', descricao: `Capital`, valor: valorResgatado })];
        if (recompensaCalculada > 0) {
            if (user.email !== ADMIN_EMAIL) {
                admin.saldo -= recompensaCalculada;
                txs.push(new Transaction({ userId: admin._id, tipo: 'Pagamento Staking', descricao: `Rendimento para ${user.nome}`, valor: -recompensaCalculada }));
            }
            txs.push(new Transaction({ userId: user._id, tipo: 'Recompensa de Staking', descricao: `Rendimento`, valor: recompensaCalculada }));
        }

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

        user.saldo += recompensaCalculada; 
        user.lastRewardClaim = Date.now();
        
        const promises = [
            user.save(),
            new Transaction({ userId: user._id, tipo: 'Recompensa de Staking', descricao: `Reivindicação`, valor: recompensaCalculada }).save()
        ];

        if (user.email !== ADMIN_EMAIL) {
            admin.saldo -= recompensaCalculada;
            promises.push(admin.save());
            promises.push(new Transaction({ userId: admin._id, tipo: 'Pagamento Staking', descricao: `Reivindicação de ${user.nome}`, valor: -recompensaCalculada }).save());
        }

        await Promise.all(promises);
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
        
        const limiteDisponivel = await calcularLimiteSaque(user._id, user.saldo, user.email);
        if (valorSC > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Operação bloqueada pelo vesting! Saldo livre disponível para uso: ${limiteDisponivel.toFixed(2)} SC.` });

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
        
        const limiteDisponivel = await calcularLimiteSaque(user._id, user.saldo, user.email);
        if (valorSC > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Operação bloqueada pelo vesting! Saldo livre disponível para uso: ${limiteDisponivel.toFixed(2)} SC.` });

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
        if (!destinatario || remetente.email === destinatario.email) return res.status(400).json({ sucesso: false, mensagem: "Destinatário inválido." });
        
        const limiteDisponivel = await calcularLimiteSaque(remetente._id, remetente.saldo, remetente.email);
        if (valorNum > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Transferência bloqueada pelo vesting! Saldo livre para envio: ${limiteDisponivel.toFixed(2)} SC.` });
        
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

app.post('/api/bot/perguntar', checkAuthenticated, async (req, res) => {
    try {
        const { mensagem } = req.body;
        const msg = (mensagem || '').toLowerCase();
        
        let resposta = "Olá! Eu sou o Assistente SolidCoin 🤖. Como posso te ajudar hoje?\n\nTente perguntar sobre: 'celo', 'metamask', 'jogo', 'solidcrush', 'saque', 'pix', 'minipay', 'sócio', 'staking', 'nfc', 'indicação', 'investimentos' ou 'nft'.";

        if (msg.includes('jogo') || msg.includes('crush') || msg.includes('ponto') || msg.includes('level') || msg.includes('nível')) {
            resposta = "🍬 **SolidCrush Saga (Nível 1 ao 1000):** Combine as joias da SolidCoin para passar de fase! Se você vencer a fase, **não perde vida** e continua jogando! A cada **1.000.000 de pontos** acumulados, você ganha automaticamente **1.000 SolidCoins**!";
        } else if (msg.includes('metamask') || msg.includes('resgate rendimento') || msg.includes('contrato')) {
            resposta = "🦊 **Rede Celo (Mainnet):** Você pode resgatar seu rendimento de **1% ao dia** direto na MetaMask e também enviar seus NFTs da plataforma para a Blockchain Celo!\n\nContrato SolidCoin (SLC): `0x6Ff689e75DD0f49375A2932E44354DD3271586f6`\nContrato SolidNFT (SNFT): `0x4340C2751F443B846262B99EE4f572Bc8784cC65`";
        } else if (msg.includes('saque') || msg.includes('sacar') || msg.includes('retirar')) {
            if (msg.includes('pix')) {
                resposta = "💸 **Saque Pix VIP:** É exclusivo para Sócios da plataforma. Tem uma taxa de 5% e o valor cai direto na sua conta bancária conectada. Importante: moedas ganhas pelos planos de sócio e prêmios do jogo liberam 25% a cada 30 dias para segurança do sistema.";
            } else if (msg.includes('minipay') || msg.includes('celo')) {
                resposta = "💳 **Saque MiniPay (Web3 - Rede Celo):** O saque via MiniPay na Rede Celo é automatizado! Você recebe em dólares digitais (USDC) direto na sua carteira do Opera, podendo converter via Pix por lá. Não esqueça de salvar sua carteira na seção 'Carteiras'.";
            } else {
                resposta = "🏦 **Tipos de Saques:** Temos saque via Pix (Exclusivo para Sócios) e Saque Cripto (MiniPay Celo automatizado e Rede Solana). Vá no menu e escolha o tipo de saque que deseja. Dica: A MiniPay na Rede Celo é a forma mais rápida e econômica!";
            }
        } else if (msg.includes('sócio') || msg.includes('socio') || msg.includes('plano')) {
            resposta = "💎 **Clube de Sócios:** Sendo sócio você recebe moedas garantidas todos os meses, libera o cobiçado Saque Pix VIP e ganha 5% de comissão sobre os planos de quem você indicar! Lembre-se: O saldo comprado no plano entra em 'Vesting', ou seja, fica bloqueado e libera 25% a cada 30 dias na sua conta.";
        } else if (msg.includes('staking') || msg.includes('stake') || msg.includes('render')) {
            resposta = "📈 **Staking:** Coloque suas moedas para trabalhar para você! O Staking da SolidCoin paga 5% ao mês sobre o valor guardado na plataforma, além do rendimento Web3 de 1% ao dia direto no Smart Contract da Rede Celo.";
        } else if (msg.includes('nfc') || msg.includes('cartão') || msg.includes('cartao') || msg.includes('maquininha')) {
            resposta = "💳 **Tecnologia NFC:** Transforme seu celular numa maquininha! Você pode cobrar de outros usuários apenas encostando o cartão deles no seu celular. Vá na seção 'Tecnologia NFC' para gerar seu código ou pedir o Cartão Black físico de PVC na sua casa.";
        } else if (msg.includes('indica') || msg.includes('convid') || msg.includes('amigo')) {
            resposta = "🤝 **Programa de Indicação:** Convide amigos e ganhe! Você e seu amigo ganham 250 SC quando ele usar seu código. Melhor ainda: Se o seu amigo virar Sócio, você ganha 5% de comissão do plano dele NA HORA e com saldo 100% livre para saque!";
        } else if (msg.includes('invest') || msg.includes('fii') || msg.includes('ação') || msg.includes('acao') || msg.includes('mercado')) {
            resposta = "📊 **Mercado de Ativos:** Use suas SolidCoins para comprar cotas de Fundos Imobiliários (FIIs) e Ações de empresas reais no nosso simulador atrelado à vida real. Você receberá dividendos sempre que o ADM distribuir os lucros no sistema!";
        } else if (msg.includes('nft') || msg.includes('avatar') || msg.includes('farm') || msg.includes('raridade')) {
            resposta = "🖼️ **Universo NFT SolidCoin:** Aqui está tudo o que você precisa saber sobre os nossos NFTs:\n\n" +
                       "✨ **Mint na Plataforma & Raridade (1/1):** Você pode Mintar novos NFTs na aba de Lançamentos. Cada NFT é único e sai da loja assim que alguém o compra!\n\n" +
                       "⛏️ **Farm Diário & Avatar:** Vá no seu Inventário e clique em 'Equipar Avatar'. Sua foto de perfil mudará e o NFT começará a minerar SolidCoins automaticamente a cada 24 horas!\n\n" +
                       "⛓️ **Mintar na Blockchain (Celo):** No seu Inventário, você pode clicar em 'Mintar na Blockchain' para transferir seu NFT oficialmente para sua carteira MetaMask na Rede Celo (`0x4340C2751F443B846262B99EE4f572Bc8784cC65`). Ao fazer isso, ele passa para a Blockchain e sai da plataforma!";
        } else if (msg.includes('bloquea') || msg.includes('vesting') || msg.includes('limite')) {
            resposta = "⚠️ **Saldo Bloqueado / Limite (Vesting):** Para garantir a vida longa do sistema, as moedas dos Planos de Sócio e os pacotes de 1.000 SC do SolidCrush liberam 25% a cada 30 dias de conta ativa. Porém, ganhos de indicações, vendas, farm de NFT e depósitos são 100% livres desde o primeiro dia!";
        }

        res.json({ sucesso: true, resposta });
    } catch (error) {
        res.status(500).json({ sucesso: false, resposta: "Desculpe, meu cérebro digital está reiniciando. Tente novamente em alguns segundos." });
    }
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
        let settings = await SysSettings.findOne() || new SysSettings();
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
                if (referrer && referrer.email !== ADMIN_EMAIL && admin.saldo >= (ordem.moedasReceber * 0.05)) {
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
        if (!saque || saque.status !== 'Pendente') return res.status(404).json({ sucesso: false, mensagem: "Saque não encontrado ou já processado." });
        
        if (acao === 'aprovar') {
            if (saque.solanaWallet && saque.solanaWallet.includes('MiniPay:')) {
                if (!celoWallet || !celoProvider) {
                    return res.status(500).json({ sucesso: false, mensagem: "Erro: A carteira MiniPay do Servidor não está configurada nas variáveis de ambiente (MINIPAY_PRIVATE_KEY ou MINIPAY_SEED_PHRASE)." });
                }
                
                try {
                    const { ethers } = require('ethers');
                    const enderecoDestino = saque.solanaWallet.replace('MiniPay:', '').trim();

                    const isAddressValid = ethers.isAddress ? ethers.isAddress(enderecoDestino) : ethers.utils.isAddress(enderecoDestino);
                    if (!isAddressValid) {
                        return res.status(400).json({ sucesso: false, mensagem: `Endereço MiniPay do usuário é inválido: "${enderecoDestino}". Peça para ele corrigir ou rejeite o saque.` });
                    }

                    const scRate = await getSCRate();
                    let cotacaoDolar = 5.80;
                    try {
                        const resMoeda = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
                        if (resMoeda.ok) {
                            const dadosMoeda = await resMoeda.json();
                            if (dadosMoeda && dadosMoeda.USDBRL && dadosMoeda.USDBRL.ask) {
                                cotacaoDolar = parseFloat(dadosMoeda.USDBRL.ask);
                            }
                        } else {
                            const resBackup = await fetch('https://open.er-api.com/v6/latest/USD');
                            if (resBackup.ok) {
                                const dadosBackup = await resBackup.json();
                                if (dadosBackup && dadosBackup.rates && dadosBackup.rates.BRL) {
                                    cotacaoDolar = parseFloat(dadosBackup.rates.BRL);
                                }
                            }
                        }
                    } catch (errCotacao) {
                        console.warn("⚠️ Usando cotação USD padrão de segurança:", cotacaoDolar);
                    }
                    
                    const valorBRL = saque.valor / scRate;
                    const valorUSD = valorBRL / cotacaoDolar;

                    const parseUnitsFn = ethers.parseUnits ? ethers.parseUnits : ethers.utils.parseUnits;
                    const formatUnitsFn = ethers.formatUnits ? ethers.formatUnits : ethers.utils.formatUnits;

                    const saldoCeloWei = await celoProvider.getBalance(celoWallet.address);
                    const saldoCelo = parseFloat(formatUnitsFn(saldoCeloWei, 18));
                    if (saldoCelo < 0.002) {
                        return res.status(400).json({ 
                            sucesso: false, 
                            mensagem: `Gás CELO insuficiente na carteira do servidor (${celoWallet.address}). Saldo atual: ${saldoCelo.toFixed(5)} CELO.` 
                        });
                    }

                    const erc20Abi = [
                        "function transfer(address to, uint256 value) public returns (bool)",
                        "function balanceOf(address owner) view returns (uint256)"
                    ];

                    const tokensSuportados = [
                        { nome: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
                        { nome: 'cUSD', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
                        { nome: 'USDT', address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 }
                    ];

                    let contratoEscolhido = null;
                    let quantiaWeiEscolhida = null;
                    let saldosEncontrados = [];

                    for (const tk of tokensSuportados) {
                        const contract = new ethers.Contract(tk.address, erc20Abi, celoWallet);
                        const rawBal = await contract.balanceOf(celoWallet.address);
                        const numBal = parseFloat(formatUnitsFn(rawBal, tk.decimals));
                        saldosEncontrados.push(`${tk.nome}: $${numBal.toFixed(2)}`);

                        if (numBal >= valorUSD && !contratoEscolhido) {
                            contratoEscolhido = contract;
                            quantiaWeiEscolhida = parseUnitsFn(valorUSD.toFixed(tk.decimals), tk.decimals);
                        }
                    }

                    if (!contratoEscolhido) {
                        return res.status(400).json({
                            sucesso: false,
                            mensagem: `Saldo em Dólar insuficiente na carteira do servidor (${celoWallet.address}). Necessário: $${valorUSD.toFixed(2)} USD. Saldos encontrados -> [ ${saldosEncontrados.join(' | ')} ].`
                        });
                    }

                    const tx = await contratoEscolhido.transfer(enderecoDestino, quantiaWeiEscolhida);
                    saque.txId = tx.hash; 
                } catch (txError) {
                    console.error("Falha detalhada na Blockchain Celo:", txError);
                    const motivoErro = txError.shortMessage || txError.reason || txError.message || "Erro desconhecido";
                    return res.status(500).json({ 
                        sucesso: false, 
                        mensagem: `Falha MiniPay (${celoWallet ? celoWallet.address : 'Sem carteira'}): ${motivoErro}` 
                    });
                }
            }

            saque.status = 'Aprovado';
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            const redeNome = saque.solanaWallet ? saque.solanaWallet.split(':')[0] : 'Cripto';
            const promessas = [saque.save()];

            if (admin) {
                admin.saldo += saque.valor;
                promessas.push(admin.save());
                promessas.push(new Transaction({
                    userId: admin._id,
                    tipo: 'Recebimento Saque Cripto',
                    descricao: `${redeNome} de ${saque.nomeUsuario}`,
                    valor: saque.valor
                }).save());
            }

            await Promise.all(promessas);
            res.json({ sucesso: true, mensagem: `✅ Saque APROVADO! As ${saque.valor} SC retornaram ao saldo do CEO.`});
        } else if (acao === 'rejeitar') {
            const user = await User.findById(saque.userId);
            user.saldo += saque.valor; saque.status = 'Rejeitado';
            await Promise.all([user.save(), saque.save(), new Transaction({ userId: user._id, tipo: 'Estorno', descricao: saque.solanaWallet.split(':')[0], valor: saque.valor }).save()]);
            res.json({ sucesso: true, mensagem: "REJEITADO." });
        }
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro interno ao processar saque." }); }
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

async function setupInicial() {
    try {
        let ceo = await User.findOne({ email: ADMIN_EMAIL });
        if (!ceo) {
            const senhaHash = await bcrypt.hash("SolidCoin$24", 10);
            ceo = new User({ nome: "CEO SolidCoin", email: ADMIN_EMAIL, senha: senhaHash, saldo: 1000000000, codigoIndicacao: 'CEO123' });
            await ceo.save();
        } else if (!ceo.codigoIndicacao) { ceo.codigoIndicacao = 'CEO123'; await ceo.save(); }
        
        const nomesDosPlanos = Object.keys(PLANOS_SOCIO);
        for (const planoNome of nomesDosPlanos) {
            const chavePlano = `plano_${planoNome}`;
            const imagemExistente = await ImagemConfig.findOne({ chave: chavePlano });
            if (!imagemExistente) {
                await new ImagemConfig({ chave: chavePlano, nomeExibicao: `Imagem: ${planoNome}`, url: PLANOS_SOCIO[planoNome].imagemUrl }).save();
            }
        }

        if (await ReferralLink.countDocuments() === 0) {
            await new ReferralLink({
                titulo: 'MultSense - Parceiro Oficial SolidCoin',
                descricao: 'Cadastre-se na plataforma MultSense através do nosso link oficial de referência.',
                url: 'https://multsense.com.br/?ref=SolidCoin'
            }).save();
        }

        if (!(await SysSettings.findOne())) { await new SysSettings({ scPorReal: 500 }).save(); }

        if (ceo) {
            await Transaction.deleteMany({
                userId: ceo._id,
                tipo: 'Bônus de Indicação',
                valor: 250
            });

            const txsInd = await Transaction.find({
                userId: ceo._id,
                tipo: 'Pagamento Indicação',
                valor: -500,
                descricao: { $regex: /CEO SolidCoin/i }
            });

            for (let tx of txsInd) {
                tx.valor = -250;
                tx.descricao = tx.descricao
                    .replace(/Bônus CEO SolidCoin e /i, 'Bônus Boas-Vindas para ')
                    .replace(/Para CEO SolidCoin e /i, 'Bônus Boas-Vindas para ');
                await tx.save();
            }

            const txsFarmUsuarios = await Transaction.find({
                tipo: 'Farm NFT (Diário)',
                userId: { $ne: ceo._id }
            });

            for (let fTx of txsFarmUsuarios) {
                const dataRef = fTx.data || new Date();
                const jaRegistrado = await Transaction.findOne({
                    userId: ceo._id,
                    tipo: 'Pagamento Farm NFT',
                    valor: -Math.abs(fTx.valor),
                    data: dataRef
                });

                if (!jaRegistrado) {
                    const donoNft = await User.findById(fTx.userId).select('nome');
                    const nomeDono = donoNft ? donoNft.nome : 'Usuário';
                    await new Transaction({
                        userId: ceo._id,
                        tipo: 'Pagamento Farm NFT',
                        descricao: `${fTx.descricao} (Para ${nomeDono})`,
                        valor: -Math.abs(fTx.valor),
                        data: dataRef
                    }).save();
                }
            }

            const saquesCriptoAprovados = await Withdrawal.find({ status: 'Aprovado' });
            let saldoDevolvidoCEO = 0;

            for (let sq of saquesCriptoAprovados) {
                const redeNome = sq.solanaWallet ? sq.solanaWallet.split(':')[0] : 'Cripto';
                const descEsperada = `${redeNome} de ${sq.nomeUsuario}`;
                
                const jaCreditado = await Transaction.findOne({
                    userId: ceo._id,
                    tipo: 'Recebimento Saque Cripto',
                    valor: sq.valor,
                    descricao: descEsperada
                });

                if (!jaCreditado) {
                    saldoDevolvidoCEO += sq.valor;
                    await new Transaction({
                        userId: ceo._id,
                        tipo: 'Recebimento Saque Cripto',
                        descricao: descEsperada,
                        valor: sq.valor,
                        data: sq.data || new Date()
                    }).save();
                }
            }

            if (saldoDevolvidoCEO > 0) {
                ceo.saldo += saldoDevolvidoCEO;
                await ceo.save();
            }

            console.log("✅ Ecossistema SolidCoin + Metadata JSON direto do MongoDB para a Blockchain Celo ativo!");
        }
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
                        user.statusSocio = 'Ativo'; user.planoSocio = ordem.plano; user.vencimentoSocio = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); 
                        ordem.status = 'Aprovado';
                        
                        const transacoesToSave = [
                            new Transaction({ userId: user._id, tipo: 'Assinatura Sócio SolidCoin', descricao: `Pix Automático (Robô)`, valor: ordem.moedasReceber }),
                            new Transaction({ userId: admin._id, tipo: 'Pagamento Sócio', descricao: `Para ${user.nome}`, valor: -ordem.moedasReceber })
                        ];
                        const updatesToSave = [user.save(), ordem.save()];

                        if (user.indicadoPor) {
                            const referrer = await User.findById(user.indicadoPor);
                            if (referrer && referrer.email !== ADMIN_EMAIL) {
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
                card.status = 'Expirado'; card.isUsed = true; admin.saldo += card.valor; 
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