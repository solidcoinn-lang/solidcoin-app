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

// --- INTEGRAÇÃO EFÍ (API PIX) ---
let certPath = path.join(__dirname, 'certificado.p12');

// Se estiver na nuvem (Render), cria o arquivo temporário
if (process.env.EFI_CERT_BASE64) {
    certPath = path.join(__dirname, 'certificado_render.p12');
    fs.writeFileSync(certPath, Buffer.from(process.env.EFI_CERT_BASE64, 'base64'));
}

// CHECAGEM DE SEGURANÇA (Isso vai mostrar o erro no log da Render se faltar variável)
if (!process.env.EFI_CLIENT_ID || !process.env.EFI_CLIENT_SECRET || !process.env.EFI_PIX_KEY) {
    console.error("🚨 ERRO CRÍTICO: Variáveis da Efí faltando no painel da Render!");
}

const isSandbox = process.env.EFI_ENV !== 'producao';
console.log(`🌍 MODO EFÍ: ${isSandbox ? 'HOMOLOGAÇÃO (TESTES)' : 'PRODUÇÃO (REAL)'}`);

const optionsEfi = {
    sandbox: isSandbox,
    client_id: process.env.EFI_CLIENT_ID,
    client_secret: process.env.EFI_CLIENT_SECRET,
    certificate: certPath,
    scope: 'gn.pix.write gn.pix.read' // GARANTE PERMISSÃO DE ESCRITA E LEITURA
};

const efipay = new EfiPay(optionsEfi);

// Importa os modelos
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

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = "solidcoinn@gmail.com";

// Constantes de Economia
const STAKING_REWARD_RATE_MONTHLY = 0.05; 
const WHALE_THRESHOLD = 1000000; 
const WHALE_YIELD_PER_DAY = 200;

const PLANOS_SOCIO = {
    "Socio SolidCoin para Todos": { valorReais: 1, sc: 500 },
    "Iron": { valorReais: 5, sc: 3025 },
    "Bronze": { valorReais: 10, sc: 6325 },
    "Prata": { valorReais: 20, sc: 13200 },
    "Ouro": { valorReais: 50, sc: 34375 },
    "Diamante": { valorReais: 100, sc: 71500 }
};

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log("✅ Conectado ao MongoDB Atlas!");
        setupInicial();
    }).catch(err => console.error("❌ Erro ao conectar ao MongoDB:", err));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'solidcoin-efi-secret-2026', resave: false, saveUninitialized: false, cookie: { secure: false }
}));

function checkAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ sucesso: false, mensagem: "Acesso não autorizado." });
}

function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.email === ADMIN_EMAIL) return next();
    res.status(403).send('Acesso negado. Apenas para administradores.');
}

async function getSCRate() {
    let settings = await SystemSettings.findOne();
    if (!settings) settings = await new SystemSettings({ scPorReal: 500 }).save(); 
    return settings.scPorReal;
}

// =========================================================================
// --- MOTOR DE CÁLCULO DE LIMITE DE SAQUE SAUDÁVEL (VESTING 25%) ---
// =========================================================================
async function calcularLimiteSaque(userId, currentSaldo, userEmail) {
    if (userEmail === ADMIN_EMAIL) return currentSaldo;

    const txs = await Transaction.find({ userId: userId });
    let limiteBruto = 0;
    let saquesEfetuados = 0;

    const tiposLivres = [
        'Depósito Aprovado', 'Transferência Recebida', 'Venda no Marketplace',
        'Recompensa de Staking', 'Rendimento Automático', 'Bônus de Indicação',
        'Comissão de Indicação', 'Comissão de Indicação (Sócio)', 'Bônus de Boas-Vindas',
        'Resgate Gift Card SC', 'Estorno Saque Pix', 'Estorno de Saque'
    ];

    const agora = Date.now();

    txs.forEach(tx => {
        if (tiposLivres.includes(tx.tipo)) {
            limiteBruto += tx.valor;
        } else if (tx.tipo === 'Assinatura Sócio SolidCoin') {
            const diasPassados = (agora - new Date(tx.data).getTime()) / (1000 * 60 * 60 * 24);
            const mesesPassados = Math.floor(diasPassados / 30);
            if (mesesPassados > 0) {
                const porcentagem = Math.min(mesesPassados * 0.25, 1.0); 
                limiteBruto += (tx.valor * porcentagem);
            }
        } else if (tx.tipo === 'Saque Cripto Solicitado' || tx.tipo === 'Saque Pix Solicitado' || tx.tipo === 'Saque Pix Automático') {
            saquesEfetuados += Math.abs(tx.valor);
        }
    });

    let limiteDisponivel = limiteBruto - saquesEfetuados;
    if (limiteDisponivel < 0) limiteDisponivel = 0;
    return Math.min(currentSaldo, limiteDisponivel);
}

// Rotas de Autenticação
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.post('/cadastrar', async (req, res) => {
    const { nome, email, senha, codigoIndicacao } = req.body;
    if (!nome || !email || !senha) return res.status(400).send("Dados incompletos.");
    
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
            await Promise.all([
                referrer.save(), admin.save(),
                new Transaction({ userId: referrer._id, tipo: 'Bônus de Indicação', descricao: `Você convidou ${nome}`, valor: 250 }).save(),
                new Transaction({ userId: admin._id, tipo: 'Pagamento Indicação', descricao: `Bônus pago para ${referrer.nome} e ${nome}`, valor: -500 }).save()
            ]);
        }

        const novoUsuario = new User({ nome, email, senha: senhaHash, saldo: saldoInicial, codigoIndicacao: novoCodigoUnico, indicadoPor: indicadoPorId });
        await novoUsuario.save();

        if (saldoInicial > 0) await new Transaction({ userId: novoUsuario._id, tipo: 'Bônus de Boas-Vindas', descricao: `Você usou o código de ${referrer.nome}`, valor: 250 }).save();
        res.redirect('/index.html?cadastro=sucesso');
    } catch (error) { res.status(500).send("Erro ao cadastrar."); }
});

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(senha, user.senha))) return res.status(401).send("Email ou senha inválidos."); 
        req.session.user = { id: user._id, nome: user.nome, email: user.email };
        res.redirect('/dashboard.html');
    } catch (error) { res.status(500).send("Erro no login."); }
});

app.post('/logout', checkAuthenticated, (req, res) => {
    req.session.destroy(err => { res.clearCookie('connect.sid'); res.json({ sucesso: true, mensagem: "Logout realizado." }); });
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

        const limiteSaqueAprovado = await calcularLimiteSaque(user._id, user.saldo, user.email);

        res.json({
            sucesso: true, scRate: scRate,
            usuario: { 
                nome: user.nome, saldo: user.saldo, stakedAmount: user.stakedAmount, canUnstakeAt: user.canUnstakeAt, solanaWallet: user.solanaWallet, tronWallet: user.tronWallet, isAdmin: user.email === ADMIN_EMAIL, statusSocio: user.statusSocio, planoSocio: user.planoSocio, vencimentoSocio: user.vencimentoSocio, codigoIndicacao: user.codigoIndicacao, limiteDeSaque: limiteSaqueAprovado 
            },
            marketplace: produtos.map(p => ({ id: p._id, nome: p.nome, preco: p.preco, imagemUrl: p.imagemUrl, categoria: p.categoria || 'Cédulas SolidCoin' }))
        });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao buscar dados." }); }
});

// =====================================================================
// --- ROTA DE ASSINATURA DE SÓCIO VIA API EFÍ (GERA QR CODE) ---
// =====================================================================
app.post('/api/socio/assinar', checkAuthenticated, async (req, res) => {
    try {
        const { plano, metodoPagamento } = req.body;
        if (!PLANOS_SOCIO[plano] || !metodoPagamento) return res.status(400).json({ sucesso: false, mensagem: "Dados inválidos." });

        const configPlano = PLANOS_SOCIO[plano];
        const user = await User.findById(req.session.user.id);

        if (metodoPagamento === 'Pix') {
            // CRIA COBRANÇA NA EFÍ
            let bodyCob = {
                calendario: { expiracao: 3600 },
                valor: { original: configPlano.valorReais.toFixed(2) },
                chave: process.env.EFI_PIX_KEY, // A chave pix da sua conta Efí
                solicitacaoPagador: `Assinatura Plano ${plano} - SolidCoin`
            };

            const cobResponse = await efipay.pixCreateImmediateCharge({}, bodyCob);
            
            // 🔥 CORREÇÃO: O parâmetro correto é { id: ... } e não { locId: ... }
            const qrCodeResponse = await efipay.pixGenerateQRCode({ id: cobResponse.loc.id });

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
            // Método Cripto Manual
            const novaOrdem = new SocioOrder({
                userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, plano: plano, 
                valorReais: configPlano.valorReais, moedasReceber: configPlano.sc, metodoPagamento: metodoPagamento, txId: req.body.txId || 'Manual'
            });
            await novaOrdem.save();
            res.json({ sucesso: true, mensagem: `Aviso enviado! O ADM irá verificar a transação Cripto e liberar suas SolidCoins.` });
        }
    } catch (error) { 
        console.error("Erro Efi Gerar Pix:", JSON.stringify(error, null, 2));
        res.status(500).json({ sucesso: false, mensagem: "Erro ao gerar cobrança Pix. Verifique as configurações da Efí." }); 
    }
});

// =====================================================================
// --- ROTA DE SAQUE AUTOMATIZADO VIA API EFÍ (ENVIO DE PIX) ---
// =====================================================================
app.post('/api/solicitar-saque-pix', checkAuthenticated, async (req, res) => {
    try {
        const { valorSC, tipoChave, chavePix } = req.body;
        const valorNum = parseFloat(valorSC);

        if (!valorNum || valorNum <= 0 || !tipoChave || !chavePix) return res.status(400).json({ sucesso: false, mensagem: "Dados inválidos." });

        const user = await User.findById(req.session.user.id);
        const planosPermitidos = ['Prata', 'Ouro', 'Diamante'];

        if (user.statusSocio !== 'Ativo' || !planosPermitidos.includes(user.planoSocio)) {
            return res.status(403).json({ sucesso: false, mensagem: "Saque via Pix é um benefício exclusivo para Sócios Prata, Ouro e Diamante." });
        }
        if (user.saldo < valorNum) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });

        const limiteDisponivel = await calcularLimiteSaque(user._id, user.saldo, user.email);
        if (valorNum > limiteDisponivel) {
            return res.status(400).json({ sucesso: false, mensagem: `Saque Bloqueado. Limite de saque liberado no momento é de: ${limiteDisponivel.toFixed(2)} SC.` });
        }

        const scRate = await getSCRate();
        const taxaSC = valorNum * 0.05; 
        const valorLiquidoSC = valorNum - taxaSC;
        const valorBRL = valorLiquidoSC / scRate;

        // TENTA ENVIAR O PIX AUTOMATICAMENTE VIA EFÍ
        let bodyEnvioPix = {
            valor: valorBRL.toFixed(2),
            pagador: { chave: process.env.EFI_PIX_KEY }, // Chave de saída do CEO
            favorecido: { chave: chavePix } // Chave do Usuário VIP
        };

        try {
            const envioResponse = await efipay.pixSend({}, bodyEnvioPix);
            
            // SE O PIX PASSAR COM SUCESSO:
            user.saldo -= valorNum;
            const admin = await User.findOne({email: ADMIN_EMAIL});
            admin.saldo += valorNum; // Volta o valor pro CEO (Economia circular)

            const novoSaquePix = new PixWithdrawal({
                userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, chavePix: chavePix, tipoChavePix: tipoChave,
                valorSC: valorNum, taxaSC: taxaSC, valorBRL: valorBRL, 
                status: 'Aprovado', txId: envioResponse.e2eId // Guarda o comprovante do banco
            });

            await Promise.all([
                user.save(), admin.save(), novoSaquePix.save(),
                new Transaction({ userId: user._id, tipo: 'Saque Pix Automático', descricao: `Efetuado para Chave: ${chavePix}`, valor: -valorNum }).save(),
                new Transaction({ userId: admin._id, tipo: 'Saque Pix Processado', descricao: `Para ${user.nome}`, valor: valorNum }).save()
            ]);

            return res.json({ sucesso: true, mensagem: `Saque Processado com Sucesso! R$ ${valorBRL.toFixed(2)} transferidos para sua conta via Pix agora.` });

        } catch (erroPix) {
            console.error("Erro no envio do Pix Efí:", erroPix);
            return res.status(500).json({ sucesso: false, mensagem: "Erro ao realizar a transferência no Banco (Efí). Verifique se a chave está correta ou informe o ADM." });
        }

    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro geral ao processar saque." }); }
});

// =====================================================================
// --- WEBHOOK EFÍ (AVISO DE PAGAMENTO RECEBIDO) ---
// =====================================================================
app.post('/api/webhook/pix', async (req, res) => {
    // A Efí exige que o servidor responda 200 OK imediatamente.
    res.status(200).send('OK');

    try {
        if (req.body.pix && req.body.pix.length > 0) {
            for (let pagamento of req.body.pix) {
                const txid_pago = pagamento.txid;
                
                // Procura se esse pagamento pertence a um plano de Sócio pendente
                const ordem = await SocioOrder.findOne({ txId: txid_pago, status: 'Pendente' });
                
                if (ordem) {
                    const user = await User.findById(ordem.userId);
                    const admin = await User.findOne({ email: ADMIN_EMAIL });
                    
                    if (admin && admin.saldo >= ordem.moedasReceber) {
                        admin.saldo -= ordem.moedasReceber;
                        user.saldo += ordem.moedasReceber;
                        user.statusSocio = 'Ativo';
                        user.planoSocio = ordem.plano;
                        user.vencimentoSocio = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); 
                        ordem.status = 'Aprovado';

                        const transacoesToSave = [
                            new Transaction({ userId: user._id, tipo: 'Assinatura Sócio SolidCoin', descricao: `Plano ${ordem.plano} (Pix Automático)`, valor: ordem.moedasReceber }),
                            new Transaction({ userId: admin._id, tipo: 'Pagamento Sócio', descricao: `Para ${user.nome}`, valor: -ordem.moedasReceber })
                        ];
                        const updatesToSave = [user.save(), ordem.save()];

                        // Paga afiliado se houver
                        if (user.indicadoPor) {
                            const referrer = await User.findById(user.indicadoPor);
                            if (referrer) {
                                const comissao = ordem.moedasReceber * 0.05;
                                if (admin.saldo >= comissao) {
                                    admin.saldo -= comissao; referrer.saldo += comissao;
                                    transacoesToSave.push(new Transaction({ userId: referrer._id, tipo: 'Comissão de Indicação (Sócio)', descricao: `Automático: 5% de ${user.nome}`, valor: comissao }));
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
            }
        }
    } catch (e) { console.error("Erro ao processar Webhook Pix Efí:", e); }
});

// --- ROTA MANUAL DE CHECAGEM PIX PARA O ADM (POLLING FALLBACK) ---
app.post('/api/admin/verificar-pix-efi', isAdmin, async (req, res) => {
    try {
        const ordensPendentes = await SocioOrder.find({ status: 'Pendente', metodoPagamento: 'Pix Efí' });
        let aprovadas = 0;

        for (let ordem of ordensPendentes) {
            try {
                const cob = await efipay.pixDetailCharge({ txid: ordem.txId });
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
            } catch (e) { /* Ignora se der erro num txid específico e tenta o próximo */ }
        }
        res.json({ sucesso: true, mensagem: `Sincronização concluída. ${aprovadas} pagamentos Pix foram identificados e aprovados automaticamente.` });
    } catch (e) { res.status(500).json({ sucesso: false, mensagem: "Erro ao comunicar com a Efí." }); }
});


// OUTRAS ROTAS GERAIS (Depósito, Saque Cripto, etc) MANTIDAS
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
        await User.findByIdAndUpdate(req.session.user.id, { solanaWallet: req.body.solanaWallet || '', tronWallet: req.body.tronWallet || '' });
        res.json({ sucesso: true, mensagem: "Carteiras atualizadas com sucesso!" });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao salvar carteiras." }); }
});

app.post('/api/solicitar-saque', checkAuthenticated, async (req, res) => {
    try {
        const valor = parseFloat(req.body.valor);
        const user = await User.findById(req.session.user.id);
        
        if (!valor || valor <= 0) return res.status(400).json({ sucesso: false, mensagem: "Valor inválido." });
        if (!user.solanaWallet && !user.tronWallet) return res.status(400).json({ sucesso: false, mensagem: "Você precisa salvar pelo menos uma carteira de saque."});
        if (user.saldo < valor) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });
        
        const limiteDisponivel = await calcularLimiteSaque(user._id, user.saldo, user.email);
        if (valor > limiteDisponivel) return res.status(400).json({ sucesso: false, mensagem: `Saque Bloqueado. Limite disponível: ${limiteDisponivel.toFixed(2)} SC.` });

        const carteiraParaSaque = user.solanaWallet ? `Solana: ${user.solanaWallet}` : `Tron: ${user.tronWallet}`;
        user.saldo -= valor; await user.save();

        await Promise.all([
            new Withdrawal({ userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, solanaWallet: carteiraParaSaque, valor: valor, status: 'Pendente' }).save(),
            new Transaction({ userId: user._id, tipo: 'Saque Cripto Solicitado', descricao: `Rede Cripto`, valor: -valor }).save()
        ]);
        res.json({ sucesso: true, mensagem: "Solicitação de saque Cripto enviada!" });
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

// Staking, Marketplace, Giftcards
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

// --- ADMIN ROTAS ---
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
        const admin = await User.findOne({ email: ADMIN_EMAIL });
        if (admin.saldo < valor) return res.status(400).json({ sucesso: false, mensagem: "Insuficiente CEO." });

        const cod = 'SOLID-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        admin.saldo -= valor;
        await Promise.all([ admin.save(), new SolidCoinGiftCard({ codigo: cod, valor: valor }).save(), new Transaction({ userId: admin._id, tipo: 'Geração Gift', descricao: cod, valor: -valor }).save() ]);
        res.json({ sucesso: true, mensagem: `Criado: ${cod}` });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/resgatar-giftcard-solidcoin', checkAuthenticated, async (req, res) => {
    try {
        const giftCard = await SolidCoinGiftCard.findOne({ codigo: req.body.codigo });
        if (!giftCard || giftCard.isUsed) return res.status(400).json({ sucesso: false, mensagem: "Inválido/Usado." });

        const user = await User.findById(req.session.user.id);
        user.saldo += giftCard.valor; giftCard.isUsed = true; giftCard.usedBy = user._id; giftCard.usedAt = new Date();
        await Promise.all([user.save(), giftCard.save(), new Transaction({ userId: user._id, tipo: 'Resgate', descricao: req.body.codigo, valor: giftCard.valor }).save()]);
        res.json({ sucesso: true, mensagem: `Resgatado!`, novoSaldo: user.saldo });
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
        res.json({ sucesso: true, saques, gifts, recharges, depositos, socios, saquesPix });
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
            saque.status = 'Aprovado'; await saque.save(); res.json({ sucesso: true, mensagem: `APROVADO.`});
        } else if (acao === 'rejeitar') {
            const user = await User.findById(saque.userId);
            user.saldo += saque.valor; saque.status = 'Rejeitado';
            await Promise.all([user.save(), saque.save(), new Transaction({ userId: user._id, tipo: 'Estorno', descricao: 'Cripto', valor: saque.valor }).save()]);
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
        if (!(await SystemSettings.findOne())) { await new SystemSettings({ scPorReal: 500 }).save(); }
    } catch (e) { console.error("Erro no setup inicial:", e); }
}

app.listen(PORT, () => { console.log(`\n🚀 SolidCoin App rodando na porta ${PORT}`); });