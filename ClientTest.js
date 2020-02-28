const { Peer, BonjourDiscovery } = require('./index')

const client = new Peer('Test', { client: true, port: 5001 }, BonjourDiscovery)

const http = require('http')

let i = 0
const server = http.createServer(async (req, res) => {
  res.write((await client.ask('X', i++)).toString())
  res.end()
})

server.listen(3000)
