const express = require('express');
const axios = require('axios');
const router = express.Router();

router.post('/estoque', async (req, res) => {
  
  const codigo_produto = req.body.codigo_produto;

  if (!codigo_produto) {
    return res.status(400).json({ erro: 'Você esqueceu de mandar o codigo_produto!' });
  }

  try {
    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/estoque/resumo/', {
      call: 'ObterEstoqueProduto',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        { 
          nIdProduto: parseInt(codigo_produto)
        }
      ] 
    });

    console.log("Resposta da Omie:", JSON.stringify(respostaOmie.data, null, 2));

    let saldo = 0;
    if (respostaOmie.data.listaEstoque && respostaOmie.data.listaEstoque.length > 0) {
        saldo = respostaOmie.data.listaEstoque[0].nDisponivel || 0;
    }

    res.json({
      sucesso: true,
      produto_id: codigo_produto,
      saldo_disponivel: saldo
    });

  } catch (error) {
    console.log("Deu erro na Omie:", error.response?.data || error.message);
    res.status(500).json({ erro: 'Erro ao consultar a Omie' });
  }
});

// Rota para listar os produtos e descobrirmos os códigos!
router.get('/produtos', async (req, res) => {
  try {
    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', {
      call: 'ListarProdutos',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        {
          pagina: 1,
          registros_por_pagina: 50, // Aumentei para trazer até 50 produtos
          apenas_importado_api: "N",
          filtrar_apenas_omiepdv: "N"
        }
      ]
    });

    // Vamos limpar a resposta para mostrar só o nome e o código que precisamos
    const listaLimpa = respostaOmie.data.produto_servico_cadastro.map(produto => ({
      nome: produto.descricao,
      codigo_para_usar_no_estoque: produto.codigo_produto // Esse é o nCodProd!
    }));

    res.json(listaLimpa);

  } catch (error) {
    console.log("Erro ao buscar produtos:", error.response?.data || error.message);
    res.status(500).json({ erro: 'Não consegui listar os produtos' });
  }
});

module.exports = router;