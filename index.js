require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const crypto = require('crypto'); // Necessário para gerar os códigos aleatórios

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

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = "solidcoinn@gmail.com";

// Constantes de Economia
const STAKING_REWARD_RATE_MONTHLY = 0.05; // 5% ao mês
const WHALE_THRESHOLD = 1000000; // 1 Milhão de SolidCoins
const WHALE_YIELD_PER_DAY = 200;

// TABELA DE PLANOS DE SÓCIO SOLIDCOIN
const PLANOS_SOCIO = {
    "Socio SolidCoin para Todos": { valorReais: 1, sc: 500 },
    "Iron": { valorReais: 5, sc: 3025 },
    "Bronze": { valorReais: 10, sc: 6325 },
    "Prata": { valorReais: 20, sc: 13200 },
    "Ouro": { valorReais: 50, sc: 34375 },
    "Diamante": { valorReais: 100, sc: 71500 }
};

// Conexão com MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log("✅ Conectado ao MongoDB Atlas!");
        setupInicial();
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

// Helper para pegar a cotação dinâmica
async function getSCRate() {
    let settings = await SystemSettings.findOne();
    if (!settings) { 
        settings = await new SystemSettings({ scPorReal: 500 }).save(); 
    }
    return settings.scPorReal;
}

// Rotas de Página e Autenticação
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.post('/cadastrar', async (req, res) => {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).send("Dados incompletos.");
    try {
        if (await User.findOne({ email })) return res.status(409).send("Email já cadastrado.");
        const senhaHash = await bcrypt.hash(senha, 10);
        await new User({ nome, email, senha: senhaHash }).save();
        res.redirect('/index.html?cadastro=sucesso');
    } catch (error) { 
        res.status(500).send("Erro ao cadastrar."); 
    }
});

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(senha, user.senha))) { 
            return res.status(401).send("Email ou senha inválidos."); 
        }
        req.session.user = { id: user._id, nome: user.nome, email: user.email };
        res.redirect('/dashboard.html');
    } catch (error) { 
        res.status(500).send("Erro no login."); 
    }
});

app.post('/logout', checkAuthenticated, (req, res) => {
    req.session.destroy(err => {
        if(err) return res.status(500).json({ sucesso: false, message: "Erro ao fazer logout."});
        res.clearCookie('connect.sid');
        res.json({ sucesso: true, mensagem: "Logout realizado." });
    });
});

// --- ROTAS DA API ---

// Dados do Dashboard
app.get('/api/dados-dashboard', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const produtos = await Product.find({});
        const scRate = await getSCRate();
        
        // Verifica Inadimplência do Sócio
        if (user.statusSocio === 'Ativo' && user.vencimentoSocio && new Date() > new Date(user.vencimentoSocio)) {
            user.statusSocio = 'Inadimplente';
            await user.save();
        }

        // Rendimento para Baleias
        const agora = new Date();
        const tempoPassado = agora - new Date(user.lastYieldApplied);
        const diasPassados = tempoPassado / (1000 * 60 * 60 * 24);

        if(user.saldo >= WHALE_THRESHOLD && diasPassados >= 1 && user.email !== ADMIN_EMAIL) {
            const diasInteiros = Math.floor(diasPassados);
            const rendimentoGanho = diasInteiros * WHALE_YIELD_PER_DAY;
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            
            if (admin && admin.saldo >= rendimentoGanho) {
                admin.saldo -= rendimentoGanho;
                user.saldo += rendimentoGanho;
                user.lastYieldApplied = agora;
                
                const transacaoRendimento = new Transaction({
                    userId: user._id, 
                    tipo: 'Rendimento Automático', 
                    descricao: `Rendimento de ${diasInteiros} dia(s)`, 
                    valor: rendimentoGanho
                });
                await Promise.all([user.save(), admin.save(), transacaoRendimento.save()]);
            }
        }

        res.json({
            sucesso: true,
            scRate: scRate,
            usuario: { 
                nome: user.nome, saldo: user.saldo, stakedAmount: user.stakedAmount, canUnstakeAt: user.canUnstakeAt,
                solanaWallet: user.solanaWallet, tronWallet: user.tronWallet, isAdmin: user.email === ADMIN_EMAIL,
                statusSocio: user.statusSocio, planoSocio: user.planoSocio, vencimentoSocio: user.vencimentoSocio
            },
            marketplace: produtos.map(p => ({
                id: p._id, nome: p.nome, preco: p.preco, imagemUrl: p.imagemUrl, categoria: p.categoria || 'Cédulas SolidCoin'
            }))
        });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao buscar dados." }); 
    }
});

// --- ROTA: ASSINAR SÓCIO SOLIDCOIN ---
app.post('/api/socio/assinar', checkAuthenticated, async (req, res) => {
    try {
        const { plano, metodoPagamento, txId } = req.body;
        
        if (!PLANOS_SOCIO[plano] || !metodoPagamento || !txId) {
            return res.status(400).json({ sucesso: false, mensagem: "Dados inválidos." });
        }

        const configPlano = PLANOS_SOCIO[plano];
        const user = await User.findById(req.session.user.id);
        
        const novaOrdem = new SocioOrder({
            userId: user._id, 
            nomeUsuario: user.nome, 
            emailUsuario: user.email,
            plano: plano, 
            valorReais: configPlano.valorReais, 
            moedasReceber: configPlano.sc,
            metodoPagamento: metodoPagamento, 
            txId: txId
        });
        
        await novaOrdem.save();
        res.json({ sucesso: true, mensagem: `Comprovante enviado! O ADM irá verificar a transação e liberar suas SolidCoins do plano ${plano}.` });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao solicitar assinatura." }); 
    }
});

// --- ROTA DE DEPÓSITO ---
app.post('/api/depositar', checkAuthenticated, async (req, res) => {
    try {
        const { rede, linkTransacao, valor } = req.body;
        const valorNum = parseFloat(valor);
        
        if (!rede || !linkTransacao || !valorNum || valorNum <= 0) {
            return res.status(400).json({ sucesso: false, mensagem: "Dados inválidos." });
        }

        const user = await User.findById(req.session.user.id);
        const novoDeposito = new Deposit({
            userId: user._id, 
            nomeUsuario: user.nome, 
            emailUsuario: user.email,
            rede: rede, 
            linkTransacao: linkTransacao, 
            valor: valorNum
        });
        
        await novoDeposito.save();
        res.json({ sucesso: true, mensagem: "Aviso de depósito enviado! O ADM irá verificar o link e liberar suas SolidCoins em breve." });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao registrar depósito." }); 
    }
});

// Carteiras e Saques
app.post('/api/salvar-carteira', checkAuthenticated, async (req, res) => {
    try {
        const { solanaWallet, tronWallet } = req.body;
        await User.findByIdAndUpdate(req.session.user.id, { 
            solanaWallet: solanaWallet || '', 
            tronWallet: tronWallet || '' 
        });
        res.json({ sucesso: true, mensagem: "Carteiras updated com sucesso!" });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao salvar carteiras." }); 
    }
});

app.post('/api/solicitar-saque', checkAuthenticated, async (req, res) => {
    try {
        const valor = parseFloat(req.body.valor);
        const user = await User.findById(req.session.user.id);
        
        if (!valor || valor <= 0) return res.status(400).json({ sucesso: false, mensagem: "Valor inválido." });
        if (!user.solanaWallet && !user.tronWallet) return res.status(400).json({ sucesso: false, mensagem: "Você precisa salvar pelo menos uma carteira de saque."});
        if (user.saldo < valor) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente." });
        
        const carteiraParaSaque = user.solanaWallet ? `Solana: ${user.solanaWallet}` : `Tron: ${user.tronWallet}`;
        const novoSaque = new Withdrawal({ 
            userId: user._id, 
            nomeUsuario: user.nome, 
            emailUsuario: user.email, 
            solanaWallet: carteiraParaSaque, 
            valor: valor, 
            status: 'Pendente'
        });
        
        await novoSaque.save();
        res.json({ sucesso: true, mensagem: "Solicitação de saque enviada!" });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao solicitar saque." }); 
    }
});

app.get('/api/meus-saques', checkAuthenticated, async (req, res) => {
    try {
        const saques = await Withdrawal.find({ userId: req.session.user.id }).sort({ data: -1 });
        res.json({ sucesso: true, saques });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao buscar saques." });
    }
});

// --- ROTAS DE STAKING ---
app.post('/api/staking/stake', checkAuthenticated, async (req, res) => {
    try {
        const valor = parseFloat(req.body.valor);
        const user = await User.findById(req.session.user.id);
        
        if (!valor || valor <= 0) return res.status(400).json({ sucesso: false, mensagem: "Valor inválido." });
        if (user.saldo < valor) return res.status(400).json({ sucesso: false, margin: "Saldo insuficiente." });

        user.saldo -= valor;
        user.stakedAmount += valor;
        user.canUnstakeAt = new Date(Date.now() + 48 * 60 * 60 * 1000); 
        user.lastRewardClaim = new Date(); 
        
        await user.save();
        res.json({ sucesso: true, mensagem: `${valor} SolidCoins colocadas em staking!`, usuario: { saldo: user.saldo, stakedAmount: user.stakedAmount, canUnstakeAt: user.canUnstakeAt } });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao fazer staking." }); 
    }
});

app.post('/api/staking/unstake', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const admin = await User.findOne({ email: ADMIN_EMAIL });

        if (user.stakedAmount <= 0) return res.status(400).json({ sucesso: false, mensagem: "Você não tem moedas em staking." });
        if (new Date() < new Date(user.canUnstakeAt)) return res.status(400).json({ sucesso: false, mensagem: `Você só pode resgatar após ${new Date(user.canUnstakeAt).toLocaleString('pt-BR')}`});

        const tempoPassadoMs = new Date() - new Date(user.lastRewardClaim);
        const diasPassados = tempoPassadoMs / (1000 * 60 * 60 * 24);
        let recompensaCalculada = (user.stakedAmount * (STAKING_REWARD_RATE_MONTHLY / 30)) * diasPassados;
        
        if (recompensaCalculada < 0) recompensaCalculada = 0;

        if (recompensaCalculada > 0 && admin.saldo < recompensaCalculada) {
            return res.status(500).json({ sucesso: false, mensagem: "Recursos do sistema indisponíveis no momento para pagar o rendimento." });
        }

        const valorResgatado = user.stakedAmount;

        user.saldo += (valorResgatado + recompensaCalculada);
        user.stakedAmount = 0;
        user.canUnstakeAt = null;

        if (recompensaCalculada > 0) {
            admin.saldo -= recompensaCalculada;
        }

        const transacao = new Transaction({ 
            userId: user._id, 
            tipo: 'Resgate de Staking', 
            descricao: `Capital: ${valorResgatado.toFixed(2)} SC | Rendimento: ${recompensaCalculada.toFixed(2)} SC`, 
            valor: (valorResgatado + recompensaCalculada)
        });

        await Promise.all([user.save(), admin.save(), transacao.save()]);

        res.json({ 
            sucesso: true, 
            mensagem: `Resgate Concluído!\n\nVocê recebeu de volta ${valorResgatado.toFixed(2)} SC e lucrou mais ${recompensaCalculada.toFixed(2)} SC de rendimento!`, 
            usuario: { saldo: user.saldo, stakedAmount: user.stakedAmount } 
        });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao resgatar staking." }); 
    }
});

app.post('/api/staking/claim-rewards', checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const admin = await User.findOne({ email: ADMIN_EMAIL });
        
        if (user.stakedAmount <= 0) return res.status(400).json({ sucesso: false, mensagem: "Você precisa de moedas em staking para reivindicar." });

        const tempoPassadoMs = new Date() - new Date(user.lastRewardClaim);
        const diasPassados = tempoPassadoMs / (1000 * 60 * 60 * 24);
        const recompensaCalculada = (user.stakedAmount * (STAKING_REWARD_RATE_MONTHLY / 30)) * diasPassados;

        if (recompensaCalculada < 0.01) return res.status(400).json({ sucesso: false, mensagem: "RECOMPENSA muito baixa para reivindicar." });
        if (admin.saldo < recompensaCalculada) return res.status(500).json({ sucesso: false, mensagem: "Recursos indisponíveis no momento." });

        admin.saldo -= recompensaCalculada;
        user.saldo += recompensaCalculada;
        user.lastRewardClaim = new Date();

        const transacao = new Transaction({ 
            userId: user._id, 
            tipo: 'Recompensa de Staking', 
            descricao: `Reivindicação de ${recompensaCalculada.toFixed(2)} SC`, 
            valor: recompensaCalculada 
        });
        
        await Promise.all([user.save(), admin.save(), transacao.save()]);
        res.json({ sucesso: true, mensagem: `Você reivindicou ${recompensaCalculada.toFixed(2)} SC!`, usuario:{ saldo: user.saldo }});
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao reivindicar." }); 
    }
});

// --- ROTA DE COMPRAR GIFT CARD EXTERNO (Google Play/Shopee) - CORRIGIDA ---
app.post('/api/giftcard/comprar', checkAuthenticated, async (req, res) => {
    try {
        const { tipo, valorReais } = req.body;
        const valorR = parseFloat(valorReais);
        
        if (tipo === 'Shopee' && (valorR < 30 || valorR > 300)) return res.status(400).json({ sucesso: false, mensagem: "Shopee: Valor entre R$ 30 e R$ 300." });
        if (tipo === 'Google Play' && (valorR < 15 || valorR > 300)) return res.status(400).json({ sucesso: false, mensagem: "Google Play: Valor entre R$ 15 e R$ 300." });

        const scRate = await getSCRate();
        const valorSC = valorR * scRate;
        const [user, admin] = await Promise.all([ User.findById(req.session.user.id), User.findOne({ email: ADMIN_EMAIL }) ]);
        
        if (user.saldo < valorSC) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente em SolidCoins." });

        user.saldo -= valorSC; 
        admin.saldo += valorSC;
        
        // CORREÇÃO: Força o status Pendente e mapeia ambos os modelos de nomenclaturas anteriores
        const order = new GiftCardOrder({ 
            userId: user._id, 
            nomeUsuario: user.nome, 
            emailUsuario: user.email, 
            tipoGift: tipo, 
            tipo: tipo,
            valorReais: valorR, 
            valorBRL: valorR,
            valorSolidCoin: valorSC, 
            custoSolidCoin: valorSC,
            status: 'Pendente' 
        });
        
        const txUser = new Transaction({ userId: user._id, tipo: 'Compra Gift Card', descricao: `Pedido ${tipo} - R$ ${valorR.toFixed(2)} (Aguardando PIN)`, valor: -valorSC });
        const txAdmin = new Transaction({ userId: admin._id, tipo: 'Venda Gift Card', descricao: `Pedido ${tipo} por ${user.nome}`, valor: valorSC });

        await Promise.all([user.save(), admin.save(), order.save(), txUser.save(), txAdmin.save()]);
        res.json({ sucesso: true, mensagem: `Pedido de Gift Card ${tipo} enviado! O ADM enviará o PIN no seu extrato em breve.`, novoSaldo: user.saldo });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao processar compra do Gift Card." }); 
    }
});

app.post('/api/recharge/comprar', checkAuthenticated, async (req, res) => {
    try {
        const { operadora, valorReais, numeroCelular } = req.body;
        const valorR = parseFloat(valorReais);
        
        const validValues = {
            Claro: [20, 25, 30, 35, 40, 50, 100],
            Vivo: [20, 25, 30, 35, 40, 50, 100, 200, 300],
            Tim: [20, 30, 40, 50, 60, 100]
        };

        if (!validValues[operadora] || !validValues[operadora].includes(valorR)) return res.status(400).json({ sucesso: false, mensagem: "Valor inválido para a operadora selecionada." });
        if (!numeroCelular || numeroCelular.length < 10) return res.status(400).json({ sucesso: false, mensagem: "Número de celular inválido." });

        const scRate = await getSCRate();
        const valorSC = valorR * scRate;
        const [user, admin] = await Promise.all([ User.findById(req.session.user.id), User.findOne({ email: ADMIN_EMAIL }) ]);
        
        if (user.saldo < valorSC) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente em SolidCoins." });

        user.saldo -= valorSC; 
        admin.saldo += valorSC;
        
        const order = new RechargeOrder({ userId: user._id, nomeUsuario: user.nome, emailUsuario: user.email, operadora, numeroCelular, valorReais: valorR, valorSolidCoin: valorSC, status: 'Pendente' });
        const txUser = new Transaction({ userId: user._id, tipo: 'Recarga de Celular', descricao: `Pedido ${operadora} (${numeroCelular}) - R$ ${valorR.toFixed(2)}`, valor: -valorSC });
        const txAdmin = new Transaction({ userId: admin._id, tipo: 'Venda Recarga', descricao: `Recarga ${operadora} por ${user.nome}`, valor: valorSC });

        await Promise.all([user.save(), admin.save(), order.save(), txUser.save(), txAdmin.save()]);
        res.json({ sucesso: true, mensagem: `Pedido de Recarga enviado! O ADM confirmará o NSU em breve no extrato.`, novoSaldo: user.saldo });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao pedir Recarga." }); 
    }
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
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao transferir." }); 
    }
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
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao comprar." }); 
    }
});

app.get('/api/extrato', checkAuthenticated, async (req, res) => {
    try {
        const transacoes = await Transaction.find({ userId: req.session.user.id }).sort({ data: -1 }).limit(50);
        res.json({ sucesso: true, transacoes });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar extrato.' });
    }
});

// --- ADMIN: GERENCIAMENTO DE USUÁRIOS E SENHAS ---
app.get('/api/admin/usuarios', isAdmin, async (req, res) => {
    try {
        const usuarios = await User.find({ email: { $ne: ADMIN_EMAIL } }).select('nome email statusSocio planoSocio');
        res.json({ sucesso: true, usuarios });
    } catch (e) { 
        res.status(500).json({ sucesso: false }); 
    }
});

app.post('/api/admin/alterar-senha-usuario', isAdmin, async (req, res) => {
    try {
        const { userId, novaSenha } = req.body;
        if (!userId || !novaSenha || novaSenha.length < 4) return res.status(400).json({ sucesso: false, mensagem: "Senha muito curta ou inválida." });
        
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ sucesso: false, mensagem: "Usuário não encontrado." });

        const senhaHash = await bcrypt.hash(novaSenha, 10);
        user.senha = senhaHash;
        await user.save();

        res.json({ sucesso: true, mensagem: `Senha do usuário ${user.nome} redefinida com sucesso!` });
    } catch (e) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao alterar a senha." }); 
    }
});

// --- ADMIN: COTAÇÃO DINÂMICA E INADIMPLENTES ---
app.post('/api/admin/atualizar-cotacao', isAdmin, async (req, res) => {
    try {
        const novaCotacao = parseFloat(req.body.cotacao);
        if(!novaCotacao || novaCotacao <= 0) return res.status(400).json({ sucesso: false });
        
        let settings = await SystemSettings.findOne();
        if(!settings) settings = new SystemSettings();
        
        settings.scPorReal = novaCotacao;
        await settings.save();
        res.json({ sucesso: true, mensagem: `Cotação atualizada para R$ 1,00 = ${novaCotacao} SC` });
    } catch(e) { 
        res.status(500).json({ sucesso: false }); 
    }
});

app.get('/api/admin/inadimplentes', isAdmin, async (req, res) => {
    try {
        const inadimplentes = await User.find({ statusSocio: 'Inadimplente' }).select('nome email planoSocio vencimentoSocio');
        res.json({ sucesso: true, inadimplentes });
    } catch (e) { 
        res.status(500).json({ sucesso: false }); 
    }
});

app.post('/api/admin/cancelar-socio', isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.body.userId);
        if(!user) return res.status(404).json({ sucesso: false });
        
        user.statusSocio = 'Inativo'; 
        user.planoSocio = ''; 
        user.vencimentoSocio = null;
        
        await user.save();
        res.json({ sucesso: true, mensagem: "Plano do usuário cancelado." });
    } catch (e) { 
        res.status(500).json({ sucesso: false }); 
    }
});

// ADM GERA O CÓDIGO E DESCONTA DO SEU SALDO
app.post('/api/admin/gerar-giftcard-solidcoin', isAdmin, async (req, res) => {
    try {
        const valor = parseFloat(req.body.valor);
        if (!valor || valor <= 0) return res.status(400).json({ sucesso: false, mensagem: "Valor inválido." });

        const admin = await User.findOne({ email: ADMIN_EMAIL });
        if (admin.saldo < valor) return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente na conta do CEO para gerar este Gift Card." });

        const codigoGerado = 'SOLID-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        admin.saldo -= valor;

        const novoGift = new SolidCoinGiftCard({ codigo: codigoGerado, valor: valor });
        const transacaoAdmin = new Transaction({ userId: admin._id, tipo: 'Geração Gift Card SC', descricao: `Código gerado: ${codigoGerado}`, valor: -valor });

        await Promise.all([admin.save(), novoGift.save(), transacaoAdmin.save()]);
        res.json({ sucesso: true, mensagem: `Gift Card gerado com sucesso!\nCódigo: ${codigoGerado}\nValor: ${valor} SC` });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao gerar Gift Card SolidCoin." }); 
    }
});

// USUÁRIO RESGATA O CÓDIGO
app.post('/api/resgatar-giftcard-solidcoin', checkAuthenticated, async (req, res) => {
    try {
        const { codigo } = req.body;
        if (!codigo) return res.status(400).json({ sucesso: false, message: "O código é obrigatório." });

        const giftCard = await SolidCoinGiftCard.findOne({ codigo: codigo });
        if (!giftCard) return res.status(404).json({ sucesso: false, mensagem: "Código inválido ou inexistente." });
        if (giftCard.isUsed) return res.status(400).json({ sucesso: false, mensagem: "Este Gift Card já foi resgatado." });

        const user = await User.findById(req.session.user.id);
        user.saldo += giftCard.valor;
        giftCard.isUsed = true; 
        giftCard.usedBy = user._id; 
        giftCard.usedAt = new Date();

        const transacaoUser = new Transaction({ userId: user._id, tipo: 'Resgate Gift Card SC', descricao: `Resgate do código ${codigo}`, valor: giftCard.valor });

        await Promise.all([user.save(), giftCard.save(), transacaoUser.save()]);
        res.json({ sucesso: true, mensagem: `Parabéns! Você resgatou ${giftCard.valor} SolidCoins com sucesso!`, novoSaldo: user.saldo });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao resgatar Gift Card SolidCoin." }); 
    }
});

// --- ROTAS DO ADMIN (PAINEL GERAL) ---
app.get('/api/admin/pedidos-pendentes', isAdmin, async (req, res) => {
    try {
        const saques = await Withdrawal.find({ status: 'Pendente' }).sort({ data: 1 });
        const gifts = await GiftCardOrder.find({ status: 'Pendente' }).sort({ data: 1 });
        const recharges = await RechargeOrder.find({ status: 'Pendente' }).sort({ data: 1 });
        const depositos = await Deposit.find({ status: 'Pendente' }).sort({ data: 1 });
        const socios = await SocioOrder.find({ status: 'Pendente' }).sort({ data: 1 });
        
        res.json({ sucesso: true, saques, gifts, recharges, depositos, socios });
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao buscar pedidos." }); 
    }
});

app.post('/api/admin/processar-socio', isAdmin, async (req, res) => {
    try {
        const { orderId, acao } = req.body;
        const ordem = await SocioOrder.findById(orderId);
        
        if (!ordem || ordem.status !== 'Pendente') return res.status(404).json({ sucesso: false, mensagem: "Pedido não encontrado." });

        if (acao === 'aprovar') {
            const user = await User.findById(ordem.userId);
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            
            if (admin.saldo < ordem.moedasReceber) return res.status(400).json({ sucesso: false, mensagem: "CEO sem saldo para pagar o plano." });

            admin.saldo -= ordem.moedasReceber;
            user.saldo += ordem.moedasReceber;
            user.statusSocio = 'Ativo';
            user.planoSocio = ordem.plano;
            user.vencimentoSocio = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias
            ordem.status = 'Aprovado';

            await Promise.all([
                user.save(), admin.save(), ordem.save(),
                new Transaction({ userId: user._id, tipo: 'Assinatura Sócio SolidCoin', descricao: `Plano ${ordem.plano}`, valor: ordem.moedasReceber }).save(),
                new Transaction({ userId: admin._id, tipo: 'Pagamento Sócio', descricao: `Entregue a ${user.nome}`, valor: -ordem.moedasReceber }).save()
            ]);
            res.json({ sucesso: true, mensagem: `Plano approved! O usuário agora é Sócio ${ordem.plano}.` });
        } else {
            ordem.status = 'Rejeitado'; 
            await ordem.save();
            res.json({ sucesso: true, mensagem: "Assinatura rejeitada." });
        }
    } catch (error) { 
        res.status(500).json({ sucesso: false }); 
    }
});

app.post('/api/admin/processar-deposito', isAdmin, async (req, res) => {
    try {
        const { depositId, acao } = req.body;
        const deposito = await Deposit.findById(depositId);
        
        if (!deposito || deposito.status !== 'Pendente') return res.status(404).json({ sucesso: false, mensagem: "Depósito não encontrado." });

        const user = await User.findById(deposito.userId);
        const admin = await User.findOne({ email: ADMIN_EMAIL });

        if (acao === 'aprovar') {
            if (admin.saldo < deposito.valor) return res.status(400).json({ sucesso: false, mensagem: "O CEO não possui SolidCoins suficientes para creditar este depósito." });
            
            admin.saldo -= deposito.valor;
            user.saldo += deposito.valor;
            deposito.status = 'Aprovado';

            const txUser = new Transaction({ userId: user._id, tipo: 'Depósito Aprovado', descricao: `Depósito via ${deposito.rede}`, valor: deposito.valor });
            const txAdmin = new Transaction({ userId: admin._id, tipo: 'Depósito Creditado', descricao: `Depósito para ${user.nome}`, valor: -deposito.valor });

            await Promise.all([user.save(), admin.save(), deposito.save(), txUser.save(), txAdmin.save()]);
            res.json({ sucesso: true, mensagem: "Depósito APROVADO! As SolidCoins foram enviadas para o usuário." });
        } else {
            deposito.status = 'Rejeitado';
            await deposito.save();
            res.json({ sucesso: true, mensagem: "Depósito REJEITADO." });
        }
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao processar depósito." }); 
    }
});

app.post('/api/admin/processar-saque', isAdmin, async (req, res) => {
    try {
        const { withdrawalId, acao } = req.body;
        const saque = await Withdrawal.findById(withdrawalId);
        
        if (!saque || saque.status !== 'Pendente') return res.status(404).json({ sucesso: false, mensagem: "Solicitação não encontrada." });
        
        if (acao === 'aprovar') {
            const user = await User.findById(saque.userId);
            if (user.saldo < saque.valor){
                saque.status = 'Rejeitado';
                await saque.save();
                return res.status(400).json({ sucesso: false, mensagem: "Saldo insuficiente. Rejeitado." });
            }
            user.saldo -= saque.valor;
            saque.status = 'Aprovado';
            const transacao = new Transaction({ userId: user._id, tipo: 'Saque Aprovado', descricao: `Saque de ${saque.valor.toFixed(2)} para carteira`, valor: -saque.valor });
            await Promise.all([user.save(), saque.save(), transacao.save()]);
            res.json({ sucesso: true, mensagem: `Saque APROVADO.`});
        } else if (acao === 'rejeitar') {
            saque.status = 'Rejeitado';
            await saque.save();
            res.json({ sucesso: true, mensagem: "Saque REJEITADO." });
        }
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao processar saque." }); 
    }
});

app.post('/api/admin/processar-giftcard', isAdmin, async (req, res) => {
    try {
        const { orderId, acao, pin } = req.body;
        const order = await GiftCardOrder.findById(orderId);
        
        if (!order || order.status !== 'Pendente') return res.status(404).json({ sucesso: false, mensagem: "Pedido não encontrado ou já processado." });

        if (acao === 'aprovar' || acao === 'enviar_pin') { 
            if(!pin) return res.status(400).json({ sucesso: false, mensagem: "O PIN é obrigatório." });
            order.status = 'Concluido';
            order.pin = pin;
            const transacaoPin = new Transaction({
                userId: order.userId, tipo: 'Entrega de Gift Card', 
                descricao: `O PIN do seu Gift Card ${order.tipoGift || order.tipo} (R$ ${order.valorReais || order.valorBRL}) é: ${pin}`, valor: 0
            });
            await Promise.all([order.save(), transacaoPin.save()]);
            res.json({ sucesso: true, mensagem: "PIN enviado para o extrato do usuário com sucesso!" });

        } else if (acao === 'rejeitar') {
            const user = await User.findById(order.userId);
            const admin = await User.findOne({ email: ADMIN_EMAIL });
            const custoReal = order.valorSolidCoin || order.custoSolidCoin;
            
            user.saldo += custoReal;
            admin.saldo -= custoReal;
            order.status = 'Rejeitado';
            
            const transacaoEstorno = new Transaction({
                userId: user._id, tipo: 'Estorno Gift Card', 
                descricao: `Reembolso. O pedido de Gift Card ${order.tipoGift || order.tipo} foi cancelado.`, valor: custoReal
            });
            await Promise.all([user.save(), admin.save(), order.save(), transacaoEstorno.save()]);
            res.json({ sucesso: true, mensagem: "Pedido rejeitado e saldo estornado para o usuário."});
        } else {
            res.status(400).json({ sucesso: false, mensagem: "Ação inválida." });
        }
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao processar Gift Card." }); 
    }
});

app.post('/api/admin/processar-recharge', isAdmin, async (req, res) => {
    try {
        const { rechargeId, acao, nsu } = req.body;
        const order = await RechargeOrder.findById(rechargeId);
        
        if (!order || order.status !== 'Pendente') return res.status(400).json({ sucesso: false, mensagem: "Pedido inválido."});
        const [user, admin] = await Promise.all([User.findById(order.userId), User.findOne({ email: ADMIN_EMAIL })]);

        if (acao === 'aprovar') {
            order.status = 'Concluido'; 
            order.nsu = nsu;
            const tx = new Transaction({ userId: user._id, tipo: 'Recarga Concluída', descricao: `${order.operadora} (${order.numeroCelular}). NSU: ${nsu}`, valor: 0 });
            await Promise.all([order.save(), tx.save()]);
            res.json({ sucesso: true, mensagem: "NSU enviado ao usuário!" });
        } else {
            order.status = 'Rejeitado'; 
            admin.saldo -= order.valorSolidCoin; 
            user.saldo += order.valorSolidCoin;
            const txR = new Transaction({ userId: user._id, tipo: 'Reembolso Recarga', descricao: `Cancelada: ${order.operadora}`, valor: order.valorSolidCoin });
            await Promise.all([order.save(), admin.save(), user.save(), txR.save()]);
            res.json({ sucesso: true, mensagem: "Cancelado e reembolsado." });
        }
    } catch (error) { 
        res.status(500).json({ sucesso: false, mensagem: "Erro ao processar recarga."}); 
    }
});

// FUNÇÕES DE SETUP
async function setupInicial() {
    try {
        if (!(await User.findOne({ email: ADMIN_EMAIL }))) {
            const senhaHash = await bcrypt.hash("SolidCoin$24", 10);
            await new User({ nome: "CEO SolidCoin", email: ADMIN_EMAIL, senha: senhaHash, saldo: 1000000000 }).save();
        }
        if (await Product.countDocuments() === 0) {
            await Product.insertMany([
                { nome: 'Cedula SolidCoin 1000', preco: 1000, imagemUrl: 'https://i.postimg.cc/vBmmytJq/projeto-page-0001.png', categoria: 'Cédulas SolidCoin'},
                { nome: 'Cedula SolidCoin 5000', preco: 5000, imagemUrl: 'https://i.postimg.cc/1XZDMTnn/projeto2-page-0001.png', categoria: 'Cédulas SolidCoin'},
                { nome: 'Cedula SolidCoin 10000', preco: 10000, imagemUrl: 'https://i.postimg.cc/XNwfXVmw/projeto3-page-0001.png', categoria: 'Cédulas SolidCoin'},
                { nome: 'Cedula SolidCoin 100000', preco: 100000, imagemUrl: 'https://i.postimg.cc/MHxj1QN1/projeto4-page-0001.png', categoria: 'Cédulas SolidCoin'}
            ]);
        }
        if (!(await SystemSettings.findOne())) { 
            await new SystemSettings({ scPorReal: 500 }).save(); 
        }
    } catch (e) { 
        console.error("Erro no setup inicial:", e); 
    }
}

app.listen(PORT, () => { console.log(`\n🚀 SolidCoin App rodando na porta ${PORT}`); });