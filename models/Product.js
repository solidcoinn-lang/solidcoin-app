const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    // Vamos usar o _id automático do MongoDB, mas se quiser um ID numérico, pode adicionar
    // productId: { type: Number, required: true, unique: true },
    nome: {
        type: String,
        required: true
    },
    preco: {
        type: Number,
        required: true
    },
    imagemUrl: { // Corrigido para imagemUrl
        type: String,
        default: 'https://via.placeholder.com/100x100?text=Sem+Imagem'
    }
});

module.exports = mongoose.model('Product', ProductSchema);