// Exemplo de estrutura para o dbService.js
// Ajuste conforme o banco de dados que você utiliza (SQLite, PostgreSQL, MongoDB, etc.)

const db = {
    query: async (sql, params) => {
        // Sua lógica de conexão e execução de query aqui
        console.log("Executando query:", sql);
        return [];
    }
};

module.exports = db;