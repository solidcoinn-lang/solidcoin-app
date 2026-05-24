require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");

// Importa os modelos
const User = require('./models/User');
const Product = require('./models/Product');
const Transaction = require('./models/Transaction');
const Withdrawal = require('./models/Withdrawal');
const GiftCardOrder = require('./models/GiftCardOrder');
const RechargeOrder = require('./models/RechargeOrder'); // <-- NOVO MODELO

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = "solidcoinn@gmail.com";

// --- CONSTANTES DE ECONOMIA ---
const STAKING_REWARD_RATE_MONTHLY = 0.05; 
const WHALE_THRESHOLD = 1000000; 
const WHALE_YIELD_PER_DAY = 200;
const SC_POR_REAL = 500; // 500 SC = R$ 1,00

// Conexão com MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log("✅ Conectado ao MongoDB Atlas!");
        criarAdminSeNaoExistir();
        criarProdutosSeNaoExistirem();
    }).catch(err => console.error("❌ Erro ao conectar ao MongoDB:", err));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'seu-segredo-super-secreto-aqui', resave: false, saveUninitialized: false, cookie: { secure: false }}));

function checkAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ sucesso: false, mensagem: "Acesso não autorizado." });
}
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.email === ADMIN_EMAIL) return next();
    res.status(403).send('Acesso negado.');
}

// Autenticação
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.post('/cadastrar', async (req, res) => {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).send("Dados incompletos.");
    try {
        if (await User.findOne({ email })) return res.status(409).send("Email já cadastrado.");
        const senhaHash = await bcrypt.hash(senha, 10);
        await new User({ nome, email, senha: senhaHash }).save();
        res.redirect('/index.html?cadastro=sucesso');
    } catch (error) { res.status(500).send("Erro ao cadastrar."); }
});
app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(senha, user.senha))) { return res.status(401).send("Email ou senha inválidos."); }
        req.session.user = { id: user._id, nome: user.nome, email: user.email };
        res.redirect('/dashboard.html');
    } catch (error) { res.status(500).send("Erro no login."); }
});
app.post('/logout', checkAuthenticated, (req, res) => {
    req.session.destroy(err => { res.clearCookie('connect.sid'); res.json({ sucesso: true, mensagem: "Logout realizado." }); });
});

// Dados Dashboard
app.get('/api/dados-dashboard', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const produtos = await Product.find({});
        const agora = new Date();
        const tempoPassado = agora - new Date(user.lastYieldApplied);
        const diasPassados = tempoPassado / (1000 * 60 * 60 * 24);

        if (user.saldo >= WHALE_THRESHOLD && diasPassados >= 1) {
            const diasInteiros = Math.floor(diasPassados);
            const rendimentoGanho = diasInteiros * WHALE_YIELD_PER_DAY;
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            if (admin && admin.saldo >= rendimentoGanho) {
                admin.saldo -= rendimentoGanho;
                user.saldo += rendimentoGanho;
                user.lastYieldApplied = agora;
                const transacao = new Transaction({ userId: user._id, tipo: 'Rendimento Automático', descricao: `Rendimento de ${diasInteiros} dia(s)`, valor: rendimentoGanho });
                await Promise.all([user.save(), admin.save(), transacao.save()]);
            }
        }
        res.json({
            sucesso: true,
            usuario: { nome: user.nome, saldo: user.saldo, stakedAmount: user.stakedAmount, canUnstakeAt: user.canUnstakeAt, solanaWallet: user.solanaWallet, tronWallet: user.tronWallet, isAdmin: user.email === ADMIN_EMAIL },
            marketplace: produtos.map(p => ({id: p._id, nome: p.nome, preco: p.preco, imagemUrl: p.imagemUrl, categoria: p.categoria || 'Cédulas SolidCoin'}))
        });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao buscar dados." }); }
});

// Carteiras e Saques
app.post('/api/salvar-carteira', checkAuthenticated, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.session.user.id, { solanaWallet: req.body.solanaWallet || '', tronWallet: req.body.tronWallet || '' });
        res.json({ sucesso: true, mensagem: "Carteiras atualizadas!" });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/solicitar-saque', checkAuthenticated, async (req, res) => {
    try {
        const valor = parseFloat(req.body.valor);
        const user = await User.findById(req.session.user.id);
        if (!valor || valor <= 0 || (!user.solanaWallet && !user.tronWallet) || user.saldo < valor) return res.status(400).json({ sucesso: false, mensagem: "Dados inválidos ou saldo insuficiente." });
        const carteiraParaSaque = user.solanaWallet ? `Solana: ${user.solanaWallet}` : `Tron: ${user.tronWallet}`;
        await new Withdrawal({ userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, solanaWallet: carteiraParaSaque, valor: valor, status: 'Pendente' }).save();
        res.json({ sucesso: true, mensagem: "Solicitação enviada!" });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});
app.get('/api/meus-saques', checkAuthenticated, async (req, res) => {
    try { res.json({ sucesso: true, saques: await Withdrawal.find({ userId: req.session.user.id }).sort({ data: -1 }) }); } catch (error) { res.status(500).json({ sucesso: false }); }
});

// Staking
app.post('/api/staking/stake', checkAuthenticated, async (req, res) => {
    try {
        const valor = parseFloat(req.body.valor);
        const user = await User.findById(req.session.user.id);
        if (!valor || valor <= 0 || user.saldo < valor) return res.status(400).json({ sucesso: false, mensagem: "Inválido ou saldo insuficiente." });
        user.saldo -= valor; user.stakedAmount += valor; user.canUnstakeAt = new Date(Date.now() + 48 * 60 * 60 * 1000); user.lastRewardClaim = new Date();
        await user.save();
        res.json({ sucesso: true, mensagem: "SolidCoins em staking!", usuario: { saldo: user.saldo, stakedAmount: user.stakedAmount, canUnstakeAt: user.canUnstakeAt } });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});
app.post('/api/staking/unstake', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        if (user.stakedAmount <= 0 || new Date() < new Date(user.canUnstakeAt)) return res.status(400).json({ sucesso: false, mensagem: "Não disponível." });
        const valorResgatado = user.stakedAmount; user.saldo += valorResgatado; user.stakedAmount = 0; user.canUnstakeAt = null;
        await user.save();
        res.json({ sucesso: true, mensagem: "SolidCoins resgatadas!", usuario: { saldo: user.saldo, stakedAmount: user.stakedAmount } });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});
app.post('/api/staking/claim-rewards', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const admin = await User.findOne({ email: ADMIN_EMAIL });
        if (user.stakedAmount <= 0) return res.status(400).json({ sucesso: false, mensagem: "Sem saldo em staking." });
        const recompensa = (user.stakedAmount * (STAKING_REWARD_RATE_MONTHLY / 30)) * ((new Date() - new Date(user.lastRewardClaim)) / (1000 * 60 * 60 * 24));
        if (recompensa < 0.01 || admin.saldo < recompensa) return res.status(400).json({ sucesso: false, mensagem: "Indisponível agora." });
        admin.saldo -= recompensa; user.saldo += recompensa; user.lastRewardClaim = new Date();
        await Promise.all([user.save(), admin.save(), new Transaction({ userId: user._id, tipo: 'Recompensa Staking', descricao: `Resgate ${recompensa.toFixed(2)} SC`, valor: recompensa }).save()]);
        res.json({ sucesso: true, mensagem: `Reivindicado ${recompensa.toFixed(2)} SC!`, usuario: { saldo: user.saldo } });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

// Comprar Produtos e Transferir
app.post('/api/comprar', checkAuthenticated, async (req, res) => {
    try {
        const [comprador, admin, produto] = await Promise.all([ User.findById(req.session.user.id), User.findOne({ email: ADMIN_EMAIL }), Product.findById(req.body.produtoId) ]);
        if (!produto || comprador.saldo < produto.preco) return res.status(400).json({ sucesso: false, mensagem: "Erro na compra." });
        comprador.saldo -= produto.preco; admin.saldo += produto.preco;
        await Promise.all([comprador.save(), admin.save(), new Transaction({ userId: comprador._id, tipo: 'Compra', descricao: produto.nome, valor: -produto.preco }).save(), new Transaction({ userId: admin._id, tipo: 'Venda', descricao: produto.nome, valor: produto.preco }).save()]);
        res.json({ sucesso: true, mensagem: "Compra realizada!", novoSaldo: comprador.saldo });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/transferir', checkAuthenticated, async (req, res) => {
    try {
        const valor = parseFloat(req.body.valor);
        const [remetente, dest] = await Promise.all([ User.findById(req.session.user.id), User.findOne({ email: req.body.emailDestinatario }) ]);
        if (!dest || remetente.saldo < valor || remetente.email === dest.email) return res.status(400).json({ sucesso: false, mensagem: "Erro na transferência." });
        remetente.saldo -= valor; dest.saldo += valor;
        await Promise.all([remetente.save(), dest.save(), new Transaction({ userId: remetente._id, tipo: 'Transferência', descricao: `Para ${dest.email}`, valor: -valor }).save(), new Transaction({ userId: dest._id, tipo: 'Transferência', descricao: `De ${remetente.email}`, valor: valor }).save()]);
        res.json({ sucesso: true, mensagem: "Transferência realizada!", novoSaldo: remetente.saldo });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.get('/api/extrato', checkAuthenticated, async (req, res) => {
    try { res.json({ sucesso: true, transacoes: await Transaction.find({ userId: req.session.user.id }).sort({ data: -1 }).limit(50) }); } catch (error) { res.status(500).json({ sucesso: false }); }
});

// --- ROTA DE GIFT CARDS (ATUALIZADA) ---
app.post('/api/giftcard/comprar', checkAuthenticated, async (req, res) => {
    try {
        const { tipo, valorReais } = req.body;
        const valorR = parseFloat(valorReais);
        
        // REGRAS DE LIMITE
        if (tipo === 'Shopee' && (valorR < 30 || valorR > 300)) return res.status(400).json({ sucesso: false, mensagem: "Shopee: Valor entre R$ 30 e R$ 300." });
        if (tipo === 'Google Play' && (valorR < 15 || valorR > 300)) return res.status(400).json({ sucesso: false, mensagem: "Google Play: Valor entre R$ 15 e R$ 300." });

        const valorSC = valorR * SC_POR_REAL;
        const [user, admin] = await Promise.all([ User.findById(req.session.user.id), User.findOne({ email: ADMIN_EMAIL }) ]);
        
        if (user.saldo < valorSC) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente em SolidCoins." });

        user.saldo -= valorSC; admin.saldo += valorSC;
        
        const order = new GiftCardOrder({ userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, tipoGift: tipo, valorReais: valorR, valorSolidCoin: valorSC });
        const txUser = new Transaction({ userId: user._id, tipo: 'Compra Gift Card', descricao: `Pedido ${tipo} - R$ ${valorR.toFixed(2)} (Aguardando PIN)`, valor: -valorSC });
        const txAdmin = new Transaction({ userId: admin._id, tipo: 'Venda Gift Card', descricao: `Pedido ${tipo} por ${user.nome}`, valor: valorSC });

        await Promise.all([user.save(), admin.save(), order.save(), txUser.save(), txAdmin.save()]);
        res.json({ sucesso: true, mensagem: `Pedido de Gift Card ${tipo} enviado! O ADM enviará o PIN no seu extrato em breve.`, novoSaldo: user.saldo });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao comprar Gift Card." }); }
});

// --- ROTA DE RECARGA DE CELULAR (NOVA) ---
app.post('/api/recharge/comprar', checkAuthenticated, async (req, res) => {
    try {
        const { operadora, valorReais, numeroCelular } = req.body;
        const valorR = parseFloat(valorReais);
        
        // Validação de segurança básica (você pode expandir as listas aqui se quiser)
        const validValues = {
            Claro: [15, 20, 25, 30, 35, 40, 50, 100],
            Vivo: [10, 12, 15, 20, 25, 30],
            Tim: [15, 20, 30, 50, 100]
        };

        if (!validValues[operadora] || !validValues[operadora].includes(valorR)) {
            return res.status(400).json({ sucesso: false, mensagem: "Valor inválido para a operadora selecionada." });
        }
        if (!numeroCelular || numeroCelular.length < 10) return res.status(400).json({ sucesso: false, mensagem: "Número de celular inválido." });

        const valorSC = valorR * SC_POR_REAL;
        const [user, admin] = await Promise.all([ User.findById(req.session.user.id), User.findOne({ email: ADMIN_EMAIL }) ]);
        
        if (user.saldo < valorSC) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente em SolidCoins." });

        user.saldo -= valorSC; admin.saldo += valorSC;
        
        const order = new RechargeOrder({ userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, operadora, numeroCelular, valorReais: valorR, valorSolidCoin: valorSC });
        const txUser = new Transaction({ userId: user._id, tipo: 'Recarga de Celular', descricao: `Pedido ${operadora} (${numeroCelular}) - R$ ${valorR.toFixed(2)}`, valor: -valorSC });
        const txAdmin = new Transaction({ userId: admin._id, tipo: 'Venda Recarga', descricao: `Recarga ${operadora} por ${user.nome}`, valor: valorSC });

        await Promise.all([user.save(), admin.save(), order.save(), txUser.save(), txAdmin.save()]);
        res.json({ sucesso: true, mensagem: `Pedido de Recarga enviado! O ADM confirmará o NSU em breve no extrato.`, novoSaldo: user.saldo });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao pedir Recarga." }); }
});


// --- ROTAS DO ADMIN (PAINEL) ---
app.get('/api/admin/pedidos-pendentes', isAdmin, async (req, res) => {
    try {
        const saques = await Withdrawal.find({ status: 'Pendente' }).sort({ data: 1 });
        const gifts = await GiftCardOrder.find({ status: 'Pendente' }).sort({ data: 1 });
        const recharges = await RechargeOrder.find({ status: 'Pendente' }).sort({ data: 1 });
        res.json({ sucesso: true, saques, gifts, recharges });
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/processar-saque', isAdmin, async (req, res) => {
    try {
        const { withdrawalId, acao } = req.body;
        const saque = await Withdrawal.findById(withdrawalId);
        if (!saque || saque.status !== 'Pendente') return res.status(400).json({ sucesso: false });
        if (acao === 'aprovar') {
            const user = await User.findById(saque.userId);
            if (user.saldo < saque.valor) { saque.status = 'Rejeitado'; await saque.save(); return res.status(400).json({ sucesso: false, mensagem: "Saldo do usuário tornou-se insuficiente." }); }
            user.saldo -= saque.valor; saque.status = 'Aprovado';
            await Promise.all([user.save(), saque.save(), new Transaction({ userId: user._id, tipo: 'Saque Aprovado', descricao: `Saque ${saque.valor}`, valor: -saque.valor }).save()]);
            res.json({ sucesso: true, mensagem: "Saque Aprovado." });
        } else { saque.status = 'Rejeitado'; await saque.save(); res.json({ sucesso: true, mensagem: "Saque Rejeitado." }); }
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

app.post('/api/admin/processar-giftcard', isAdmin, async (req, res) => {
    try {
        const { orderId, acao, pin } = req.body;
        const order = await GiftCardOrder.findById(orderId);
        if (!order || order.status !== 'Pendente') return res.status(400).json({ sucesso: false });
        const [user, admin] = await Promise.all([User.findById(order.userId), User.findOne({ email: ADMIN_EMAIL })]);

        if (acao === 'aprovar') {
            order.status = 'Concluído'; order.pin = pin;
            const tx = new Transaction({ userId: user._id, tipo: 'Gift Card Entregue', descricao: `PIN ${order.tipoGift} (R$ ${order.valorReais}): ${pin}`, valor: 0 });
            await Promise.all([order.save(), tx.save()]);
            res.json({ sucesso: true, mensagem: "PIN enviado ao usuário!" });
        } else {
            order.status = 'Cancelado'; admin.saldo -= order.valorSolidCoin; user.saldo += order.valorSolidCoin;
            const txR = new Transaction({ userId: user._id, tipo: 'Reembolso Gift Card', descricao: `Cancelado: ${order.tipoGift}`, valor: order.valorSolidCoin });
            await Promise.all([order.save(), admin.save(), user.save(), txR.save()]);
            res.json({ sucesso: true, mensagem: "Cancelado e reembolsado." });
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
            order.status = 'Concluído'; order.nsu = nsu;
            const tx = new Transaction({ userId: user._id, tipo: 'Recarga Concluída', descricao: `${order.operadora} (${order.numeroCelular}). NSU: ${nsu}`, valor: 0 });
            await Promise.all([order.save(), tx.save()]);
            res.json({ sucesso: true, mensagem: "NSU enviado ao usuário!" });
        } else {
            order.status = 'Cancelado'; admin.saldo -= order.valorSolidCoin; user.saldo += order.valorSolidCoin;
            const txR = new Transaction({ userId: user._id, tipo: 'Reembolso Recarga', descricao: `Cancelada: ${order.operadora}`, valor: order.valorSolidCoin });
            await Promise.all([order.save(), admin.save(), user.save(), txR.save()]);
            res.json({ sucesso: true, mensagem: "Cancelado e reembolsado." });
        }
    } catch (error) { res.status(500).json({ sucesso: false }); }
});

// Setup Inicial
async function criarAdminSeNaoExistir() {
    if (await User.findOne({ email: ADMIN_EMAIL })) return;
    await new User({ nome: "CEO SolidCoin", email: ADMIN_EMAIL, senha: await bcrypt.hash("SolidCoin$24", 10), saldo: 1000000000 }).save();
}
async function criarProdutosSeNaoExistirem() {
    if (await Product.countDocuments() > 0) return;
    await Product.insertMany([ { nome: 'Cedula 1000', preco: 1000, imagemUrl: '...', categoria: 'Cédulas SolidCoin' } ]);
}

app.listen(PORT, () => { console.log(`\n🚀 App na porta ${PORT}`); });