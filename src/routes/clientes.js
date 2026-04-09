const express = require('express');
const axios = require('axios');
const router = express.Router();

router.post('/consultar-cliente', async (req, res) => {
  const cnpj_cpf = req.body.cnpj_cpf;

  if (!cnpj_cpf) {
    return res.status(400).json({ erro: 'Você esqueceu de mandar o CPF!' });
  }

  const cnpj_cpfLimpo = String(cnpj_cpf).replace(/\D/g, '');

  try {
   const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', {
      call: 'ListarClientes',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        { 
          pagina: 1,
          registros_por_pagina: 10,
          clientesFiltro: {
            cnpj_cpf: cnpj_cpfLimpo
          }
        }
      ] 
    }); 

    if (respostaOmie.data.clientes_cadastro && respostaOmie.data.clientes_cadastro.length > 0) {
      const clientEncontrado = respostaOmie.data.clientes_cadastro[0];

      return res.json({
        cadastrado: true,
        mensagem: "cliente encontrado!",
        dados: {
          codigo_cliente_omie: clientEncontrado.codigo_cliente_omie,
          nome: clientEncontrado.razao_social,
          email: clientEncontrado.email
        }
      });
    } else {
      return res.json({
        cadastrado: false,
        mensagem: "Cliente não encontrado na base de dados"
      })
    }
  } catch (error) {

    const mensagemErro = error.response && error.response.data ? error.response.data.faultstring : "";

    if (mensagemErro.includes("Não existem registros")) {
      return res.json({
        cadastrado: false,
        mensagem: "Cliente não encontrado na base de dados"
      })
    }

    console.error("Erro ao consultar cliente:", error.response ? error.response.data : error.message);
    return res.status(500).json({ erro: "Erro ao consultar Omie"});
  }
});

router.get('/listar-clientes', async (req, res) => {
  try {
    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', {
      call: 'ListarClientes',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        {
          pagina: 1,
          registros_por_pagina: 50,
          apenas_importado_api: "N"
        }
      ]
    });

    if (respostaOmie.data.clientes_cadastro && respostaOmie.data.clientes_cadastro.length > 0) {
      const listaLimpa = respostaOmie.data.clientes_cadastro.map(cliente => ({
          nome: cliente.razao_social,
          cnpj_cpf: cliente.cnpj_cpf
    }));

      res.json({
        total_encontrado: listaLimpa,
        clientes: listaLimpa
      });
    } else {
      return res.json({ mensagem: "Nenhum cliente cadastrado na base ainda." });
    }

  } catch (error) {
    console.log("Erro ao buscar cliente:", error.response?.data || error.message);
    res.status(500).json({ erro: 'Não consegui listar os clientes' });
  }
});

router.post('/cadastrar-cliente', async (req, res) => {
  const {nome, cnpj_cpf, email, cep, endereco_numero} = req.body;

  console.log("👀 DADOS QUE CHEGARAM DA IA:", req.body);

  if (!nome || !cnpj_cpf || !email || !cep || !endereco_numero) {
    return res.status(400).json({ erro: "O nome, CPF, CEP, Email são obrigatorios para o cadastro."});
  }

  try {

    const cnpj_cpfLimpo = String(cnpj_cpf).replace(/\D/g, ''); 
    const cepLimpo = String(cep).replace(/\D/g, '');

    const respostaViaCep = await axios.get(`https://viacep.com.br/ws/${cepLimpo}/json/`);

    if (respostaViaCep.data.erro) {
      return res.status(400).json({ erro: "CEP não encontrado. Verifique se digitou corretamente." });
    }

    const enderecoEncontrado = respostaViaCep.data;

    const pacoteDadosCadastro = {
      call: 'IncluirCliente',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [{
        codigo_cliente_integracao: cnpj_cpf,
        cnpj_cpf: cnpj_cpfLimpo,
        razao_social: nome,
        email: email,
        endereco: enderecoEncontrado.logradouro,
        endereco_numero: endereco_numero,
        cep: cepLimpo,
        estado: enderecoEncontrado.uf,
        cidade: enderecoEncontrado.localidade,
        bairro: enderecoEncontrado.bairro,
        contribuinte: "N"
      }]
    };

    const respostaOmie = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', pacoteDadosCadastro);
  
    return res.json({
      sucesso: true,
      mensagem: "Cliente cadastrado com sucesso",
      codigo_cliente_omie: respostaOmie.data.codigo_cliente_omie
    })
  } catch (error) {
    console.error("Erro ao cadastrar cliente: ", error.response ? error.response.data : error.message);

    return res.json({
      sucesso: false,
      mensagem: "Não foi possivel cadastrar o cliente. Verifique os dados"
    });
  }
});

router.delete('/excluir-cadastro', async (req, res) => {
    try {
        const {cnpj_cpf} = req.body;
        
        if (!cnpj_cpf) {
            return res.status(400).json({erro: "Por favor envie o cpf do cliente a ser excluido"});
        }

        const pacoteExclusao = {
            call: 'ExcluirCliente',
            app_key: process.env.OMIE_APP_KEY,
            app_secret: process.env.OMIE_APP_SECRET,
            param: [{
                codigo_cliente_integracao: cnpj_cpf
            }]
        }

        const resposta = await axios.post('https://app.omie.com.br/api/v1/geral/clientes/', pacoteExclusao);

        return res.json({
            sucesso: true,
            mensagem: "Cliente apagado com sucesso",
            detalhes: resposta.data
        });

    } catch (error) {
        console.log("Erro ao excluir: ", error.response ? error.response.data : error.message);
        return res.status(500).json({
            sucesso: false,
            error: "Erro ao excluir, verifique se o cliente tem cadastro na Omie"
        });
    }
})

module.exports = router;