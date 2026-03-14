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
    console.log("Deu erro na Omie:", error.respostaOmie?.data || error.message);
    res.status(500).json({ erro: 'Erro ao consultar a Omie' });
  }
});

// Rota para listar os produtos e descobrirmos os códigos!
router.get('/listar-produtos', async (req, res) => {
  try {
    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', {
      call: 'ListarProdutos',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        {
          pagina: 4,
          registros_por_pagina: 500, // Aumentei para trazer até 50 produtos
          apenas_importado_api: "N",
          filtrar_apenas_omiepdv: "N"
        }
      ]
    });

    // Vamos limpar a resposta para mostrar só o nome e o código que precisamos
    const listaLimpa = respostaOmie.data.produto_servico_cadastro.map(produto => ({
      nome: produto.descricao,
      codigo_para_usar_no_estoque: produto.codigo_produto, // Esse é o nCodProd!
      codigo_produto_integracao: produto.codigo_produto_integracao,
      codigo: produto.codigo
    }));

    res.json(listaLimpa);

  } catch (error) {
    console.log("Erro ao buscar produtos:", error.respostaOmie?.data || error.message);
    res.status(500).json({ erro: 'Não consegui listar os produtos' });
  }
});

router.post('/consultar-produto', async (req, res) => {

  try {
    const { codigo } = req.body;

    const pacoteDados = {
      call: "ConsultarProduto",
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        {
          codigo_produto: Number(codigo)
        }
      ]
    };

    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', pacoteDados);
    if (respostaOmie.data && respostaOmie.data.codigo_produto) {
      return res.json({
        existe: true,
        nome: respostaOmie.data.descricao,
        codigo: respostaOmie.data.codigo_produto,
        valor_unitario: respostaOmie.data.valor_unitario,
        mensagem: `Encontrei o produto ${respostaOmie.data.descricao} no sistema.`
      });
    } else {
        return res.json({
          existe: false,
          mensagem: "Produto não encontrado na base da Omie."
        });
    }

  } catch (error) {
    console.error("Erro na Omie:", error.respostaOmie?.data || error.message);
    return res.status(500).json({ erro: "Falha ao consultar a Omie" });
  }

})

router.post('/listar-produtos-palavra', async (req, res) => {

  const { nome_produto } = req.body;

  console.log("👀 DADOS QUE CHEGARAM DA IA:", req.body);

  try {

    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', {
      call: 'ListarProdutos',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        {
          pagina: 1,
          registros_por_pagina: 20,
          apenas_importado_api: "N",
          filtrar_apenas_omiepdv: "N",
          filtrar_apenas_descricao: `%${nome_produto}%`
        }
      ]
    });

    // Vamos limpar a resposta para mostrar só o nome e o código que precisamos
    const listaLimpa = respostaOmie.data.produto_servico_cadastro.map(produto => ({
      nome: produto.descricao,
      codigo_para_usar_no_estoque: produto.codigo_produto, // Esse é o nCodProd!
      codigo_produto_integracao: produto.codigo_produto_integracao,
      codigo: produto.codigo
    }));

    res.json(listaLimpa);

  } catch (error) {
    console.log("Erro ao buscar produtos:", error.respostaOmie?.data || error.message);
    res.status(500).json({ erro: 'Não consegui listar os produtos' });
  }
});

router.post('/buscar-id-produto', async (req, res) => {
  const { nome_produto } = req.body;

  try {
    // 1. No Thunder Client, envie: { "nome_produto": "YEPIST" }
    

    const buscaData = {
      call: "ListarProdutos",
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        {
          pagina: 1,
          registros_por_pagina: 1,
          apenas_importado_api: "N",
          filtrar_apenas_omiepdv: "N",
          filtrar_apenas_descricao: nome_produto
        }
      ]
    };

    // Log para ver o JSON antes de enviar (se houver erro de tag, veremos aqui)
    console.log("JSON de Busca:", JSON.stringify(buscaData, null, 2));

    const response = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', buscaData);

    // 2. A Omie retorna uma lista chamada 'produto_servico_resumo'
    if (response.data.produto_servico_cadastro && response.data.produto_servico_cadastro.length > 0) {
      const produto = response.data.produto_servico_cadastro[0];
      
      return res.json({
        sucesso: true,
        id_encontrado: produto.codigo_produto, // Este é o número que a Emily vai precisar
        nome_completo: produto.descricao
      });
    } else {
      return res.json({ sucesso: false, mensagem: "Nenhum produto com esse nome." });
    }

  } catch (error) {
    // Se der erro 5001 (SOAP-ENV), o erro detalhado aparecerá aqui
    console.error("Erro na busca Omie:", error.response?.data || error.message);
    return res.status(500).json({ erro: "Falha na busca" });
  }
});

module.exports = router;