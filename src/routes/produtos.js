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

// ROTA 1: LISTAR PRODUTOS
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

// ROTA 2: LISTAR PRODUTOS COM UM FILTRO DE PALAVRA
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

// ROTA 3: CONSULTAR PRODUTO 
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

router.post('/criar-pedido', async (req, res) => {
  try {
    // 1. Agora recebemos um array chamado 'itens' que a Emily vai montar
    const { codigo_cliente_omie, itens } = req.body;
    
    console.log("🛒 DADOS DO PEDIDO RECEBIDOS DA IA:", req.body);

    // 2. Montamos as linhas do pedido dinamicamente (pode ser 1 ou 100 produtos)
    const detalhesPedido = itens.map((item, index) => {
      return {
        "ide": {
          "codigo_item_integracao": (index + 1).toString() // Gera linha 1, 2, 3...
        },
        "produto": {
          "codigo_produto": Number(item.codigo_produto),
          "quantidade": Number(item.quantidade),
          "valor_unitario": Number(item.valor_unitario)
        }
      };
    });

    const dataAtual = new Date();
    const dataFormatada = String(dataAtual.getDate()).padStart(2, '0') + '/' + 
                          String(dataAtual.getMonth() + 1).padStart(2, '0') + '/' + 
                          dataAtual.getFullYear();

    // 3. Montamos o pacote final
    const pacotePedido = {
      call: "IncluirPedido",
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        {
          "cabecalho": {
            "codigo_cliente": Number(codigo_cliente_omie),
            "codigo_pedido_integracao": Date.now().toString(), // 🌟 A MÁGICA AQUI!
            "data_previsao": dataFormatada,
            "quantidade_itens": detalhesPedido.length,
            "origem_pedido": "API"
          },
          "det": detalhesPedido,
          "informacoes_adicionais": {
            "codigo_categoria": "1.01.03", // Categoria padrão de Venda de Produtos
            "codigo_conta_corrente": 0, // ⚠️ Pode ser que a Omie exija o ID real da sua conta
            "consumidor_final": "S"
          }
        }
      ]
    };

    console.log("-> A enviar o pedido múltiplo para a Omie...");
    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/produtos/pedido/', pacotePedido);

    const numeroPedido = respostaOmie.data.numero_pedido;
    console.log(`✅ Pedido Criado com Sucesso! Número: ${numeroPedido}`);

    return res.json({
      sucesso: true,
      mensagem: `Uhuul! Pedido gerado com sucesso! O número do pedido é ${numeroPedido}.`
    });

  } catch (error) {
    console.error("⛔ ERRO AO CRIAR PEDIDO:", error.response?.data || error.message);
    return res.status(500).json({ 
      sucesso: false, 
      erro: "Não foi possível gerar o pedido no sistema." 
    });
  }
});

module.exports = router;