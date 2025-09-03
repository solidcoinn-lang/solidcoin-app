require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Importa os modelos
const User = require('./models/User');
const Product = require('./models/Product');
const Transaction = require('./models/Transaction');
const Withdrawal = require('./models/Withdrawal');

const app = express();
const PORT = process.env.PORT || 3000; // <-- LINHA ATUALIZADA AQUI
const ADMIN_EMAIL = "solidcoinn@gmail.com";

// Conexão com MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log("✅ Conectado ao MongoDB Atlas!");
        criarAdminSeNaoExistir();
        criarProdutosSeNaoExistirem();
    }).catch(err => console.error("❌ Erro ao conectar ao MongoDB:", err));

// Middlewares
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'seu-segredo-super-secreto-aqui', resave: false, saveUninitialized: false, cookie: { secure: false }
}));

// Middlewares de Autenticação
function checkAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ sucesso: false, mensagem: "Acesso não autorizado." });
}
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.email === ADMIN_EMAIL) return next();
    res.status(403).send('Acesso negado. Apenas para administradores.');
}

// Rotas de Página e Autenticação (Completas)
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
    req.session.destroy(err => {
        if (err) return res.status(500).json({ sucesso: false, mensagem: "Erro ao fazer logout."});
        res.clearCookie('connect.sid');
        res.json({ sucesso: true, mensagem: "Logout realizado." });
    });
});
// (As rotas de recuperação de senha estão omitidas por brevidade, mas devem estar no seu código se você as implementou)


// --- ROTAS DA API ---

app.get('/api/dados-dashboard', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const produtos = await Product.find({});
        res.json({
            sucesso: true,
            usuario: { nome: user.nome, saldo: user.saldo, solanaWallet: user.solanaWallet, isAdmin: user.email === ADMIN_EMAIL },
            marketplace: produtos.map(p => ({id: p._id, nome: p.nome, preco: p.preco, imagemUrl: p.imagemUrl}))
        });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao buscar dados." }); }
});

app.post('/api/salvar-carteira', checkAuthenticated, async (req, res) => {
    try {
        const { solanaWallet } = req.body;
        if (!solanaWallet) return res.status(400).json({ sucesso: false, mensagem: "Endereço da carteira é obrigatório." });
        await User.findByIdAndUpdate(req.session.user.id, { solanaWallet });
        res.json({ sucesso: true, mensagem: "Carteira Solana salva com sucesso!" });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao salvar carteira." }); }
});

app.post('/api/solicitar-saque', checkAuthenticated, async (req, res) => {
    try {
        const valor = parseFloat(req.body.valor);
        const user = await User.findById(req.session.user.id);
        if (!valor || valor <= 0) return res.status(400).json({ sucesso: false, mensagem: "Valor inválido." });
        if (!user.solanaWallet) return res.status(400).json({ sucesso: false, mensagem: "Você precisa salvar uma carteira Solana primeiro." });
        if (user.saldo < valor) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });
        const novoSaque = new Withdrawal({
            userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email,
            solanaWallet: user.solanaWallet, valor: valor, status: 'Pendente'
        });
        await novoSaque.save();
        res.json({ sucesso: true, mensagem: "Solicitação de saque enviada!" });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao solicitar saque." }); }
});

app.get('/api/meus-saques', checkAuthenticated, async (req, res) => {
    try {
        const saques = await Withdrawal.find({ userId: req.session.user.id }).sort({ data: -1 });
        res.json({ sucesso: true, saques });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao buscar saques." }); }
});

app.post('/api/transferir', checkAuthenticated, async (req, res) => {
    const { emailDestinatario, valor } = req.body;
    const valorNumerico = parseFloat(valor);
    if (!emailDestinatario || !valorNumerico || valorNumerico <= 0) return res.status(400).json({ sucesso: false, mensagem: "Dados inválidos." });
    try {
        const remetente = await User.findById(req.session.user.id);
        const destinatario = await User.findOne({ email: emailDestinatario });
        if (!destinatario) return res.status(404).json({ sucesso: false, mensagem: "Destinatário não encontrado." });
        if (remetente.email === destinatario.email) return res.status(400).json({ sucesso: false, mensagem: "Você não pode transferir para si mesmo." });
        if (remetente.saldo < valorNumerico) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });
        remetente.saldo -= valorNumerico;
        destinatario.saldo += valorNumerico;
        const transacaoRemetente = new Transaction({ userId: remetente._id, tipo: 'Transferência Enviada', descricao: `Para ${destinatario.nome} (${destinatario.email})`, valor: -valorNumerico });
        const transacaoDestinatario = new Transaction({ userId: destinatario._id, tipo: 'Transferência Recebida', descricao: `De ${remetente.nome} (${remetente.email})`, valor: valorNumerico });
        await Promise.all([remetente.save(), destinatario.save(), transacaoRemetente.save(), transacaoDestinatario.save()]);
        res.json({ sucesso: true, mensagem: "Transferência realizada!", novoSaldo: remetente.saldo });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao transferir." }); }
});

app.post('/api/comprar', checkAuthenticated, async (req, res) => {
    const { produtoId } = req.body;
    try {
        const [comprador, admin, produto] = await Promise.all([ User.findById(req.session.user.id), User.findOne({ email: ADMIN_EMAIL }), Product.findById(produtoId) ]);
        if (!produto) return res.status(404).json({ sucesso: false, mensagem: "Produto não encontrado." });
        if (!admin) return res.status(500).json({ sucesso: false, mensagem: "Erro no sistema (ADM não encontrado)." });
        if (comprador.saldo < produto.preco) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });
        comprador.saldo -= produto.preco;
        admin.saldo += produto.preco;
        const transacaoComprador = new Transaction({ userId: comprador._id, tipo: 'Compra no Marketplace', descricao: `Compra de "${produto.nome}"`, valor: -produto.preco });
        const transacaoAdmin = new Transaction({ userId: admin._id, tipo: 'Venda no Marketplace', descricao: `Venda de "${produto.nome}" para ${comprador.nome}`, valor: produto.preco });
        await Promise.all([comprador.save(), admin.save(), transacaoComprador.save(), transacaoAdmin.save()]);
        res.json({ sucesso: true, mensagem: `Compra de "${produto.nome}" realizada!`, novoSaldo: comprador.saldo });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao comprar." }); }
});

app.get('/api/extrato', checkAuthenticated, async (req, res) => {
    try {
        const transacoes = await Transaction.find({ userId: req.session.user.id }).sort({ data: -1 }).limit(50);
        res.json({ sucesso: true, transacoes });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar extrato.' }); }
});

// ROTAS DE ADMIN
app.get('/api/admin/saques-pendentes', isAdmin, async (req, res) => {
    try {
        const saques = await Withdrawal.find({ status: 'Pendente' }).sort({ data: 1 });
        res.json({ sucesso: true, saques });
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao buscar saques pendentes." }); }
});
app.post('/api/admin/processar-saque', isAdmin, async (req, res) => {
    try {
        const { withdrawalId, acao } = req.body;
        const saque = await Withdrawal.findById(withdrawalId);
        if (!saque || saque.status !== 'Pendente') return res.status(404).json({ sucesso: false, mensagem: "Solicitação não encontrada ou já processada." });
        if (acao === 'aprovar') {
            const user = await User.findById(saque.userId);
            if (user.saldo < saque.valor) {
                saque.status = 'Rejeitado';
                await saque.save();
                return res.status(400).json({ sucesso: false, mensagem: "Saldo do usuário tornou-se insuficiente. Saque rejeitado." });
            }
            user.saldo -= saque.valor;
            saque.status = 'Aprovado';
            const transacao = new Transaction({ userId: user._id, tipo: 'Saque Aprovado', descricao: `Saque de ${saque.valor.toFixed(2)} para carteira`, valor: -saque.valor });
            await Promise.all([user.save(), saque.save(), transacao.save()]);
            res.json({ sucesso: true, mensagem: `Saque de ${user.nome} APROVADO com sucesso.` });
        } else if (acao === 'rejeitar') {
            saque.status = 'Rejeitado';
            await saque.save();
            res.json({ sucesso: true, mensagem: "Saque REJEITADO com sucesso." });
        } else {
            res.status(400).json({ sucesso: false, mensagem: "Ação inválida." });
        }
    } catch (error) { res.status(500).json({ sucesso: false, mensagem: "Erro ao processar saque." }); }
});

// FUNÇÕES DE SETUP
async function criarAdminSeNaoExistir() {
    try {
        if (await User.findOne({ email: ADMIN_EMAIL })) return;
        console.log("🔧 Criando usuário ADM padrão...");
        const senhaHash = await bcrypt.hash("SolidCoin$24", 10);
        await new User({ nome: "CEO SolidCoin", email: ADMIN_EMAIL, senha: senhaHash, saldo: 1000000000 }).save();
        console.log("✅ Usuário ADM criado com sucesso!");
    } catch (error) { console.error("Erro ao criar ADM:", error); }
}
async function criarProdutosSeNaoExistirem() {
    try {
        if (await Product.countDocuments() > 0) return;
        console.log("🔧 Criando produtos padrão no Marketplace...");
        await Product.insertMany([
            { nome: 'Cedula SolidCoin 1000', preco: 1000, imagemUrl: 'https://i.postimg.cc/vBmmytJq/projeto-page-0001.png' },
            { nome: 'Cedula SolidCoin 5000', preco: 5000, imagemUrl: 'https://i.postimg.cc/1XZDMTnn/projeto2-page-0001.png' },
            { nome: 'Cedula SolidCoin 10000', preco: 10000, imagemUrl: 'https://i.postimg.cc/XNwfXVmw/projeto3-page-0001.png' },
            { nome: 'Cedula SolidCoin 100000', preco: 100000, imagemUrl: 'https://i.postimg.cc/MHxj1QN1/projeto4-page-0001.png' }
        ]);
        console.log("✅ Produtos padrão criados com sucesso!");
    } catch (error) { console.error("Erro ao criar produtos:", error); }
}

// INICIALIZAÇÃO
app.listen(PORT, () => {
    console.log(`\n🚀 SolidCoin App rodando na porta ${PORT}`);
});
