const { Peer, BonjourDiscovery } = require('./index')

const server = new Peer('Test', { server: true, port: (Math.random() * 50000) | 0 }, BonjourDiscovery)

server.question('X', (a) => {
  return a * a
})

server.events.on('incoming', (socket) => {
  console.log(socket.remoteAddress)
})

server.events.on('outgoing', (socket) => {
  console.log(socket.remoteAddress)
})

async function x () {

}

x()
