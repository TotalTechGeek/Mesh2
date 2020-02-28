const Peer = require('./Peer')
const BonjourDiscovery = require('./BonjourDiscovery')

const server = new Peer('Test', { server: true, port: (Math.random() * 50000) | 0, client: true }, BonjourDiscovery)

server.question('X', ({a}) =>
{
    return a * a
})

async function x()
{
    

}

x()