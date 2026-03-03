# Arrow Royale

Jogo battle royale multiplayer com tema espacial. Controle sua nave, colete power-ups e seja o ultimo sobrevivente.

## Requisitos

- [Node.js](https://nodejs.org/) v18 ou superior

## Instalacao

```bash
git clone https://github.com/lfcmpi/jogo_caio.git
cd jogo_caio
npm install
```

## Como rodar

```bash
node server.js
```

O servidor inicia na porta **3000**.

## Como jogar

1. Abra o navegador em `http://localhost:3000`
2. Escolha seu nome, cor e variante de nave
3. Clique em **Launch**

### Controles

| Tecla | Acao |
|-------|------|
| W A S D | Mover a nave |
| Mouse | Mirar |
| Clique esquerdo | Atirar (segurar = rajada) |
| Clique direito | Fireball |

## Modo Game Master (GM)

O GM controla a partida (iniciar, resetar, shrink zone, ajustar HP dos jogadores).

Abra no navegador:

```
http://localhost:3000/?gm=arrow-royale-gm
```

- **Test Run** — modo treino com bots
- **Start Round** — inicia a partida
- **Shrink Zone** — reduz a area jogavel
- **Reset** — volta ao lobby

Use scroll do mouse para zoom e setas do teclado para mover a camera.

## Jogar com amigos (rede externa)

Se quiser jogar com pessoas fora da sua rede local, use o [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/):

```bash
# Instalar cloudflared (macOS)
brew install cloudflared

# Criar tunnel temporario
cloudflared tunnel --url http://localhost:3000
```

Compartilhe a URL gerada (ex: `https://xxx-xxx.trycloudflare.com`) com seus amigos.
