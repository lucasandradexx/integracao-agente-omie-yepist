const express = require('express');
const axios = require('axios');
const router = express.Router();

// ROTA 1: LISTAR PRODUTOS (ROTA NAO UTILIZADA PELA IA)
router.get('/listar-produtos', async (req, res) => {
  try {
    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', {
      call: 'ListarProdutos',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        {
          pagina: 1,
          registros_por_pagina: 50,
          apenas_importado_api: "N",
          filtrar_apenas_omiepdv: "N"
        }
      ]
    });

    const listaLimpa = respostaOmie.data.produto_servico_cadastro.map(produto => ({
      nome: produto.descricao,
      codigo_produto: produto.codigo_produto,
      codigo_produto_integracao: produto.codigo_produto_integracao,
      codigo: produto.codigo
    }));

    res.json(listaLimpa);

  } catch (error) {
    console.log("Erro ao buscar produtos:", error.respostaOmie?.data || error.message);
    res.status(500).json({ erro: 'Não consegui listar os produtos' });
  }
});

// ROTA 2: LISTAR PRODUTOS COM UM FILTRO DE PALAVRA (ROTA NAO UTILIZADA PELA IA)
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
          registros_por_pagina: 50,
          apenas_importado_api: "N",
          filtrar_apenas_omiepdv: "N",
          filtrar_apenas_descricao: `%${nome_produto}%`
        }
      ]
    });

    const listaLimpa = respostaOmie.data.produto_servico_cadastro.map(produto => ({
      nome: produto.descricao,
      codigo_produto: produto.codigo_produto, 
      codigo_produto_integracao: produto.codigo_produto_integracao,
      codigo: produto.codigo
    }));

    res.json(listaLimpa);

  } catch (error) {
    console.log("Erro ao buscar produtos:", error.respostaOmie?.data || error.message);
    res.status(500).json({ erro: 'Não consegui listar os produtos' });
  }
});

// ROTA 3: CONSULTAR PRODUTO (ROTA UTILIZADA PELA IA)
router.post('/consultar-produto', async (req, res) => {

  try {
    const { nome_produto } = req.body;
    console.log("👀 DADOS QUE CHEGARAM DA IA PARA A CONSULTA DE PRODUTO:", req.body);

    const buscaData = {
      call: "ListarProdutos",
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [{
        pagina: 1,
        registros_por_pagina: 1, 
        apenas_importado_api: "N",
        filtrar_apenas_omiepdv: "N",
        filtrar_apenas_descricao: nome_produto 
      }]
    };

    console.log("Iniciando etapa 1 (Busca ID)");
    const respostaLista = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', buscaData);
    
    const lista = respostaLista.data.produto_servico_cadastro || [];
    if (lista.length === 0) {
      console.log("<- Produto não encontrado na etapa 1.");
      return res.json({ existe: false, mensagem: "Infelizmente não encontrei esse produto exato no sistema." });
    }

    const idEncontrado = lista[0].codigo_produto;
    console.log(`ID Encontrado: ${idEncontrado}`);

    const pacoteDados = {
      call: "ConsultarProduto",
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [{
        codigo_produto: Number(idEncontrado)
      }]
    };

    console.log("Iniciando Etapa 2 (Consulta detalhada)");
    const respostaConsulta = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', pacoteDados);
    
    const produtoDetalhado = respostaConsulta.data;
    if (!produtoDetalhado.codigo_produto) {
       console.log("Falha na etapa 2 (Não retornou detalhes).");
       return res.json({ existe: false, mensagem: "Produto encontrado, mas houve falha ao obter os detalhes." });
    }

    console.log(`Produto detalhado: ${produtoDetalhado.descricao}`);
    return res.json({
      existe: true,
      nome: produtoDetalhado.descricao,
      codigo: produtoDetalhado.codigo_produto,
      valor_unitario: produtoDetalhado.valor_unitario,
      mensagem: `Encontrei o produto ${produtoDetalhado.descricao} no sistema. O preço unitário é R$ ${produtoDetalhado.valor_unitario}.`
    });

  } catch (error) {
    console.error("ERRO CRÍTICO NA CONSULTA:", error.response?.data || error.message);
    return res.status(500).json({ erro: "Falha interna ao tentar consultar o produto na Omie." });
  }
});

module.exports = router;