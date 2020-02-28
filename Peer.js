const uuid = require('uuid').v4
const net = require('net')
const events = require('events')
const msgpack = require('msgpack-lite')
const ip = require('ip')

function bufToInt(arr)
{
    return arr[0] << 24 | arr[1] << 16 | arr[2] << 8 | arr[3]
}

function intToBuf(num)
{
    return Buffer.from([
        (num >> 24) & 255,
        (num >> 16) & 255,
        (num >> 8) & 255,
        num & 255
    ])
}

function writeToSocket(socket, channel, message)
{
    setImmediate(() =>
    {
        const encoded = msgpack.encode({ channel, message })
        socket.write(intToBuf(encoded.length))
        return socket.write(encoded)
    })
}

/**
 * @param {Peer} peer
 * @param {net.Socket} client
 */
function initializeClientRead(peer, client, type)
{
    let buf = Buffer.from([])

    client.on('data', data =>
    {
        buf = Buffer.concat([buf, data])
        
        if(buf.length >= 4)
        {
            let len = bufToInt(buf)
            while(len <= (buf.length - 4))
            {
                const unpacked = msgpack.decode(buf.slice(4, len+4))

                if(unpacked.channel === 'request')
                {
                    const { question, data, id } = unpacked.message
                    peer.answer(client, question, data, id)
                }
                else
                {
                    peer.channels.emit(unpacked.channel, client, unpacked.message)
                    peer[type].emit(unpacked.channel, client, unpacked.message)
                }

                buf = buf.slice(len+4)
                len = bufToInt(buf)
            }
        }
    })

}

/**
 *
 * @param {Peer} peer
 * @param {net.Socket} client
 */
function initializeOutgoingClient(peer, client)
{
    peer.outgoing.push(client)
    client.on('close', () =>
    {
        peer.outgoing = peer.outgoing.filter(x => x !== client)
    })
    client.events = new events()
    initializeClientRead(peer, client, 'outgoingChannels')
    client.send = (channel, data) => writeToSocket(client, channel, data)
}

/**
 *
 *
 * @param {Peer} peer
 * @param {net.Socket} client
 */
function initializeIncomingClient(peer, client)
{
    peer.incoming.push(client)

    client.on('close', () =>
    {
        peer.incoming = peer.incoming.filter(x => x !== client)
    })

    client.events = new events()
    initializeClientRead(peer, client, 'incomingChannels')
    client.send = (channel, data) => writeToSocket(client, channel, data)
}

class Peer
{
    constructor(name, options, DiscoveryConstructor)
    {
        if(!options) options = {}
        const DEFAULT_OPTIONS = { client: true, server: true, autoStart: true }
        if(options.client && !options.server) options.server = false
        if(!options.client && options.server) options.client = false
        options = Object.assign({}, DEFAULT_OPTIONS, options)
        const { port, client, server } = options
        this.id = uuid()
        this.port = port
        this.client = client
        this.server = server
        this.discovery = new DiscoveryConstructor(this.id, name, { port, client, server })
        this.incoming = []
        this.outgoing = []
        this.requests = {}
        this.requestCount = 0
        this.events = new events()
        this.channels = new events()
        this.questions = {}
        this.incomingChannels = new events()
        this.outgoingChannels = new events()
        if(this.client) this.clientInit()
        if(this.server) this.serverInit()
        this.roundRobin = 0

        if(options.autoStart)
        this.start()
    }

    question(question, func)
    {
        this.questions[question] = func
    }

    async ask(question, data)
    {
        const id = this.requestCount++
        await this.send('request', { data, question, id })
        return new Promise(resolve =>
        {
            this.outgoingChannels.once(`request_${id}`, (socket, data) =>
            {
                resolve(data)
            })
        })
    }

    async answer(client, question, data, id)
    {
        if(this.questions[question])
        {
            return client.send(`request_${id}`, await this.questions[question](data))
        }

        client.send(`request_${id}`, undefined)
    }

    clientInit()
    {
        this.discovery.events.on('found', ({ addresses, port, id }) =>
        {
            this.connect(addresses, port)
        })

        this.discovery.events.on('closed', (obj) =>
        {
        })
    }

    connect(addresses, port, id)
    {
        if(this.outgoing.find(client => client.id === id)) return

        const address = addresses[0]
        
        const client = net.createConnection({ port, host: address }, () =>
        {
            client.id = id
            initializeOutgoingClient(this, client) 
            this.events.emit('outgoing')

            if(this.server)
            client.send('discover', { port: this.port, addresses: [ip.address()], id: this.id })
        })
    }

    serverInit()
    {
        this.clientServer = net.createServer(incoming =>
        {
            initializeIncomingClient(this, incoming)
        })


        if(this.client)
        this.incomingChannels.on('discover', (socket, data) =>
        {
            const { addresses, port, id } = data
            this.connect(addresses, port)
        })

        this.clientServer.listen(this.port)
    }
    
    async wait()
    {
        if(this.outgoing.length) return true
        else
        {
            if(this.awaitingOutgoing) return this.awaitingOutgoing
        }


        return this.awaitingOutgoing = new Promise(resolve =>
        {
            this.events.on('outgoing', () =>
            {
                resolve()
                delete this.awaitingOutgoing
            })
        })
    }

    async send(channel, data) 
    {
        await this.wait()
        const connection = this.outgoing[this.roundRobin++ % this.outgoing.length]
        connection.send(channel, data)
    }

    async broadcast(channel, data)
    {
        await this.wait()
        this.outgoing.forEach(out =>
        {
            out.send(channel, data)
        })
    }

    start()
    {
        this.discovery.start()
    }

    stop()
    {
        this.discovery.stop()


        if(this.server)
        this.clientServer.close()

        if(this.client)
        {
            this.incoming.forEach(client =>
            {
                client.end()
                client.destroy()
            })

            this.outgoing.forEach(client =>
            {
                client.end()
                client.destroy()
            })
        }
    }


}

module.exports = Peer