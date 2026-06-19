const mongoose = require('mongoose');

const PixWithdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nomeUsuario: { type: String, required: true },
    emailUsuario: { type: String, required: true },
    chavePix: { type: String, required: true },
    tipoChavePix: { type: String, required: true }, // CPF, Celular, E-mail, Aleatória
    valorSC: { type: Number, required: true }, // Valor bruto debitado
    taxaSC: { type: Number, required: true }, // Taxa de 5% retida
    valorBRL: { type: Number, required: true }, // Valor líquido em Reais
    txId: { type: String, default: '' }, // ID da transferência gerada pelo ADM
    status: { type: String, default: 'Pendente' }, // Pendente, Aprovado, Rejeitado
    data: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PixWithdrawal', PixWithdrawalSchema);