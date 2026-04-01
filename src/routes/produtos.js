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

//ROTA 4: CRIAR PEDIDO (ROTA UTILIZADA PELA IA)
router.post('/criar-pedido', async (req, res) => {
  try {
    const { cnpj_cpf, produtos } = req.body;

    
    console.log("🛒 DADOS DO PEDIDO RECEBIDOS DA IA:", req.body); 

    if (!cnpj_cpf) {
     return res.status(400).json({ erro: 'Você esqueceu de mandar o CPF!' });
    }

    const respostaCpf = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', {
      call: 'ListarClientes',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        { 
          pagina: 1,
          registros_por_pagina: 1,
          clientesFiltro: {
            cnpj_cpf: cnpj_cpf
          }
        }
      ] 
    }); 

    let codigo_cliente = null;

    if (respostaCpf.data.clientes_cadastro && respostaCpf.data.clientes_cadastro.length > 0) {
      const clienteEncontrado = respostaCpf.data.clientes_cadastro[0];
      codigo_cliente = clienteEncontrado.codigo_cliente_omie;
    } else {
      return res.json({
        cadastrado: false,
        mensagem: "Cliente não encontrado na base de dados"
      })
    }

    const detalhesPedido = produtos.map((produto, index) => {
      return {
        "ide": {
          "codigo_item_integracao": (index + 1).toString() // Gera linha 1, 2, 3...
        },
        "produto": {
          "codigo_produto": Number(produto.codigo_produto),
          "quantidade": Number(produto.quantidade),
          "valor_unitario": Number(produto.valor_unitario)
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
            "codigo_cliente": Number(codigo_cliente),
            "codigo_pedido_integracao": Date.now().toString(), // 🌟 A MÁGICA AQUI!
            "data_previsao": dataFormatada,
            "quantidade_itens": detalhesPedido.length,
            "origem_pedido": "API"
          },
          "det": detalhesPedido,
          "informacoes_adicionais": {
            "codigo_categoria": "1.01.95", // Categoria padrão de Venda de Produtos
            "codigo_conta_corrente": "3152079535", // ⚠️ Pode ser que a Omie exija o ID real da sua conta
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
      mensagem: `Pedido gerado com sucesso! O número do pedido é ${numeroPedido}.`
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