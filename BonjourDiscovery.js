const Discovery = require('./Discovery')
const Bonjour = require('bonjour')
class BonjourDiscovery extends Discovery {
  /**
     *
     * @param {String} name
     * @param {Number} port
     */
  constructor (id, name, options) {
    if (!options) options = {}
    const DEFAULT_OPTIONS = { client: true, server: true }
    if (options.client && !options.server) options.server = false
    if (!options.client && options.server) options.client = false
    options = Object.assign({}, DEFAULT_OPTIONS, options)
    const { port, client, server } = options
    super()
    this.bonjour = Bonjour()

    this.client = client
    this.server = server
    this.name = name
    this.port = port
    this.id = id
  }

  async search () {
    if (!this.bonjour) this.init()

    this.browser = this.bonjour.find({ type: this.name })

    this.browser.on('up', data => {
      if (data.name !== this.id) { return this.events.emit(...['found', { addresses: data.addresses, port: data.port, id: data.name }]) }
    })

    this.browser.on('down', data => {
      return this.events.emit(...['closed', data])
    })
  }

  init () {
    this.bonjour = Bonjour()
  }

  async start () {
    if (!this.bonjour) this.init()
    if (this.server) { this.publish() }
    if (this.client) { this.search() }
  }

  async stop () {
    if (this.browser) { this.browser.stop() }

    if (this.service) { this.service.stop() }

    this.bonjour.destroy()
    delete this.bonjour

    this.events.removeAllListeners('closed')
    this.events.removeAllListeners('found')
  }

  async publish () {
    if (!this.bonjour) this.init()
    this.service = this.bonjour.publish({ name: this.id, type: this.name, port: this.port })
  }
}

module.exports = BonjourDiscovery
