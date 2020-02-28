const uuid = require('uuid').v4
const net = require('net')
const EventEmitter = require('events')
const msgpack = require('msgpack-lite')
// eslint-disable-next-line no-unused-vars
const Discovery = require('./Discovery')

function bufToInt (arr) {
  return arr[0] << 24 | arr[1] << 16 | arr[2] << 8 | arr[3]
}

function intToBuf (num) {
  return Buffer.from([
    (num >> 24) & 255,
    (num >> 16) & 255,
    (num >> 8) & 255,
    num & 255
  ])
}

function writeToSocket (socket, channel, message) {
  setImmediate(() => {
    const encoded = msgpack.encode({ channel, message })
    socket.write(intToBuf(encoded.length))
    return socket.write(encoded)
  })
}

/**
 * @param {Peer} peer
 * @param {net.Socket} client
 */
function initializeClientRead (peer, client, type) {
  let buf = Buffer.from([])

  client.on('data', data => {
    buf = Buffer.concat([buf, data])

    if (buf.length >= 4) {
      let len = bufToInt(buf)
      while (len <= (buf.length - 4)) {
        const unpacked = msgpack.decode(buf.slice(4, len + 4))

        if (unpacked.channel === 'request') {
          const { question, data, id } = unpacked.message
          peer.answer(client, question, data, id)
        } else {
          peer.channels.emit(unpacked.channel, client, unpacked.message)
          peer[type].emit(unpacked.channel, client, unpacked.message)
        }

        buf = buf.slice(len + 4)
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
function initializeOutgoingClient (peer, client) {
  client.on('close', () => {
    peer.outgoingConnections = peer.outgoingConnections.filter(x => x !== client)
  })

  client.on('error', err => {
    if (err.code === 'ECONNRESET') {
      // peer.outgoingConnections = peer.outgoingConnections.filter(x => x !== client)
    }
  })

  client.events = new EventEmitter()
  initializeClientRead(peer, client, 'outgoing')
  client.send = (channel, data) => writeToSocket(client, channel, data)
}

/**
 *
 *
 * @param {Peer} peer
 * @param {net.Socket} client
 */
function initializeIncomingClient (peer, client) {
  peer.incomingConnections.push(client)

  client.on('close', () => {
    peer.incomingConnections = peer.incomingConnections.filter(x => x !== client)
  })

  client.on('error', err => {
    if (err.code === 'ECONNRESET') {
      // peer.incomingConnections = peer.incomingConnections.filter(x => x !== client)
    }
  })

  client.events = new EventEmitter()
  initializeClientRead(peer, client, 'incoming')
  client.send = (channel, data) => writeToSocket(client, channel, data)
}

class Peer {
  /**
     *
     * @param {String} name
     * @param {Object} options
     * @param {Discovery} DiscoveryConstructor
     */
  constructor (name, options, DiscoveryConstructor) {
    if (!options) options = {}
    const DEFAULT_OPTIONS = { client: true, server: true, autoStart: true }
    if (options.client && !options.server) options.server = false
    if (!options.client && options.server) options.client = false
    options = Object.assign({}, DEFAULT_OPTIONS, options)
    const { port, client, server } = options
    this.id = uuid()
    this.port = port
    this.client = client
    this.server = server
    this.discovery = new DiscoveryConstructor(this.id, name, { port, client, server })
    this.incomingConnections = []
    this.outgoingConnections = []
    this.requests = {}
    this.requestCount = 0
    this.events = new EventEmitter()
    this.channels = new EventEmitter()
    this.questions = {}
    this.incoming = new EventEmitter()
    this.outgoing = new EventEmitter()
    if (this.client) this.clientInit()
    if (this.server) this.serverInit()
    this.roundRobin = 0

    if (options.autoStart) { this.start() }
  }

  question (question, func) {
    this.questions[question] = func
  }

  async ask (question, data) {
    const id = this.requestCount++
    await this.send('request', { data, question, id })
    return new Promise(resolve => {
      this.outgoing.once(`request_${id}`, (socket, data) => {
        resolve(data)
      })
    })
  }

  async answer (client, question, data, id) {
    if (this.questions[question]) {
      return client.send(`request_${id}`, await this.questions[question](data))
    }

    client.send(`request_${id}`, undefined)
  }

  clientInit () {
    this.discovery.events.on('found', ({ addresses, port, id }) => {
      this.connect(addresses, port, id)
    })

    this.discovery.events.on('closed', (obj) => {
    })
  }

  connect (addresses, port, id) {
    if (this.outgoingConnections.find(client => client.id === id)) return

    const address = addresses[0]

    const client = net.createConnection({ port, host: address }, () => {
      client.id = id
      initializeOutgoingClient(this, client)
      this.events.emit('outgoing', client)
      if (this.server) { client.send('discover', { port: this.port, id: this.id }) }
    })

    this.outgoingConnections.push(client)

    client.setTimeout(3e3)
    client.once('connect', () => client.setTimeout(0))
    client.on('error', () => {
      this.outgoingConnections = this.outgoingConnections.filter(currentClient => currentClient !== client)
    })
  }

  serverInit () {
    this.clientServer = net.createServer(incoming => {
      initializeIncomingClient(this, incoming)
      this.events.emit('incoming', incoming)
    })

    if (this.client) {
      this.incoming.on('discover', (socket, data) => {
        const { port, id } = data
        this.connect([socket.remoteAddress], port, id)
      })
    }

    this.clientServer.listen(this.port)
  }

  async wait () {
    if (this.outgoingConnections.length) return true
    else {
      if (this.awaitingOutgoing) return this.awaitingOutgoing
    }

    this.awaitingOutgoing = new Promise(resolve => {
      this.events.on('outgoing', () => {
        resolve()
        delete this.awaitingOutgoing
      })
    })

    return this.awaitingOutgoing
  }

  async send (channel, data) {
    await this.wait()
    const connection = this.outgoingConnections[this.roundRobin++ % this.outgoingConnections.length]
    connection.send(channel, data)
  }

  async broadcast (channel, data) {
    await this.wait()
    this.outgoingConnections.forEach(out => {
      out.send(channel, data)
    })
  }

  start () {
    this.discovery.start()
  }

  stop () {
    this.discovery.stop()

    if (this.server) { this.clientServer.close() }

    if (this.client) {
      this.incomingConnections.forEach(client => {
        client.end()
        client.destroy()
      })

      this.outgoingConnections.forEach(client => {
        client.end()
        client.destroy()
      })
    }
  }
}

module.exports = Peer
