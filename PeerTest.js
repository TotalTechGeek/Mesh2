const { Peer, BonjourDiscovery } = require('./index')

const peer = new Peer('Apple', { port: (Math.random() * 50000) | 0 }, BonjourDiscovery)

peer.events.on('incoming', (socket) => {
  console.log(socket.remoteAddress)
})

peer.incoming.on('ping', (socket, data) => {
  socket.send('pong', data)
})

peer.outgoing.on('pong', (socket, data) => {
  console.log('pong', data)
})

let i = 0
setInterval(() => {
  peer.broadcast('ping', i++)
}, 2500)
